/**
 * @module editor/SpellCheckerBot
 * @description
 * Autonomous German spelling assistant that watches the editor and silently repairs finished words.
 *
 * ### Trigger Pipeline
 * `transaction` → separator detection → word extraction → eligibility filter → debounce → backend
 * call → guarded apply. Corrections only ever fire for a word the user has *completed*, i.e. one
 * followed by a {@link WORD_SEPARATORS} character or a block/hard break, so the word being typed is
 * never rewritten mid-keystroke.
 *
 * ### Loop Prevention & Safety
 * - **Self-transaction guard:** Applied corrections carry the `isSpellCheckerCorrection` meta flag
 *   and are ignored by the transaction handler, so the bot cannot re-trigger on its own edits.
 * - **Cooldown set:** Each applied correction registers a `startPos:word` key in `recentlyCorrected`
 *   for 15 s, so a user who deliberately types the word back is not overridden again.
 * - **Stale-position check:** The backend round trip is asynchronous, so before writing the result
 *   the bot re-reads the document at the recorded range and aborts unless the text is still exactly
 *   the word it sent. A correction can therefore never land on text edited in the meantime.
 * - **Focus preservation:** Corrections are dispatched straight to `editor.view` instead of a
 *   focused command chain, so the caret and selection stay where the user put them.
 *
 * ### Scope Filter
 * {@link SpellCheckerBot#_shouldCheck _shouldCheck()} skips code blocks, short words, URLs and
 * paths, mentions and hashtags, pure numbers, all-caps abbreviations, and e-mail-like tokens — the
 * categories where an LLM "correction" would be actively wrong.
 *
 * Correction itself runs server-side: {@link SpellCheckerBot#_callGemini _callGemini()} posts to the
 * authenticated `/api/spellcheck` proxy so no model API key is ever exposed to the client.
 */
import { auth } from '../firebase/config.js';

/**
 * Characters that signal "the previous word is finished" and start a check.
 * @type {Set<string>}
 */
const WORD_SEPARATORS = new Set([' ', '.', ',', '!', '?', ':', ';', '\n', ')', ']', '}', '–', '—', '"', '»', '(', '[', '{', '«', '<', '>']);

/**
 * Minimum word length to consider for correction — shorter tokens are too ambiguous to fix safely.
 * @type {number}
 */
const MIN_WORD_LENGTH = 3;

/**
 * Debounce applied after a word separator is typed (ms), so rapid typing settles before a request.
 * @type {number}
 */
const DEBOUNCE_MS = 500;

/**
 * @class SpellCheckerBot
 * @classdesc
 * Attaches to a Tiptap editor and corrects completed words in place, using the debounce, cooldown,
 * and stale-position guards described in the module header.
 *
 * @property {import('@tiptap/core').Editor} editor Editor being watched and corrected.
 * @property {import('./FirestoreYjsProvider.js').FirestoreYjsProvider} provider Collaboration
 *   provider the bot rides along with; supplies the page identity.
 * @property {string} pageId Id of the page being edited, taken from the provider.
 * @property {any|null} debounceTimer Timer id for the pending correction; a new separator restarts it.
 * @property {Set<string>} recentlyCorrected `startPos:word` keys under a 15 s cooldown, preventing
 *   the bot from fighting a user who reverts a correction.
 * @property {boolean} isDestroyed Set on teardown; checked before and after every await so in-flight
 *   corrections cannot touch a disposed editor.
 */
export class SpellCheckerBot {
  /**
   * Creates the bot. Nothing is observed until {@link SpellCheckerBot#start start()} is called.
   *
   * @param {import('@tiptap/core').Editor} editor Editor to watch.
   * @param {import('./FirestoreYjsProvider.js').FirestoreYjsProvider} provider Active collaboration
   *   provider, used for the page id.
   */
  constructor(editor, provider) {
    this.editor = editor;
    this.provider = provider;
    this.pageId = provider.pageId;
    this.debounceTimer = null;
    this.recentlyCorrected = new Set();
    this.isDestroyed = false;
    this._onTransaction = this._onTransaction.bind(this);
  }

  /**
   * Starts listening for word completions by subscribing to the editor's `transaction` event.
   *
   * @returns {void}
   */
  start() {
    console.log('[SpellCheckerBot] 🤖 Rechtschreib-Assistent aktiviert');
    this.editor.on('transaction', this._onTransaction);
  }

  /**
   * Runs on every editor transaction and decides whether a word was just finished.
   *
   * Bails out for transactions that did not change the document and for the bot's own corrections
   * (`isSpellCheckerCorrection` meta), which is what keeps it from looping on itself. It inspects the
   * character before the *post-transaction* caret; when that read comes back empty the caret has
   * crossed a block boundary or hard break, which is treated as a newline separator and the scan
   * walks back to the end of the preceding text block. Anything that is not a
   * {@link WORD_SEPARATORS} character is ignored.
   *
   * Bound in the constructor so it can be removed again on destroy.
   *
   * @param {Object} props Tiptap transaction event payload.
   * @param {import('@tiptap/pm/state').Transaction} props.transaction The dispatched transaction.
   * @returns {void}
   */
  _onTransaction({ transaction }) {
    if (this.isDestroyed) return;
    if (!transaction.docChanged) return;
    if (transaction.getMeta('isSpellCheckerCorrection')) return;

    // Use the mapped selection position after the transaction to find what was just typed.
    const { selection } = this.editor.state;
    const cursorPos = selection.from;

    if (cursorPos < 2) return;

    let charBefore = this.editor.state.doc.textBetween(cursorPos - 1, cursorPos);
    let separatorPos = cursorPos - 1;

    // Check if the user pressed Enter (split block) or Shift-Enter (hard break)
    // When crossing a block boundary or node, textBetween returns an empty string
    const $pos = this.editor.state.doc.resolve(cursorPos);
    if (charBefore === '') {
      if ($pos.parentOffset === 0 || $pos.nodeBefore?.type.name === 'hardBreak' || $pos.nodeBefore?.type.name === 'hard_break') {
        charBefore = '\n';
        
        // Find the actual end of the text block before this position
        let searchPos = cursorPos - 1;
        while (searchPos > 0) {
          const $search = this.editor.state.doc.resolve(searchPos);
          if ($search.parent.isTextblock) {
            separatorPos = searchPos;
            break;
          }
          searchPos--;
        }
      }
    }

    // Only proceed if a word separator was just typed
    if (!WORD_SEPARATORS.has(charBefore)) return;

    // Extract and queue the word before the separator
    this._extractAndQueueWord(separatorPos);
  }

  /**
   * Extracts the word that just ended and schedules its correction.
   *
   * Skips code blocks entirely, then takes the last whitespace-delimited token before the separator
   * and strips surrounding punctuation. The length of the *leading* punctuation is kept so the
   * absolute document range can be computed for the cleaned word alone — otherwise a correction
   * would overwrite the opening bracket or quote. Around that range up to 10 words of context on
   * each side are collected (capped at 200 characters per side) to give the model enough to
   * disambiguate. Words under cooldown are dropped; everything else is debounced by
   * {@link DEBOUNCE_MS}, with each new separator restarting the timer so only the latest word is
   * sent.
   *
   * @param {number} separatorPos Absolute document position of the separator that ended the word.
   * @returns {void}
   */
  _extractAndQueueWord(separatorPos) {
    const { doc } = this.editor.state;

    // Resolve position to find the parent text node
    const $pos = doc.resolve(separatorPos);
    const parentNode = $pos.parent;

    // Skip if inside a code block
    if (parentNode.type.name === 'codeBlock') return;

    // Get all text in this paragraph up to the separator position
    const textBefore = parentNode.textBetween(0, $pos.parentOffset, undefined, '\ufffc');
    if (!textBefore) return;

    // Find the last word in the text (before the separator)
    const wordMatch = textBefore.match(/(\S+)$/);
    if (!wordMatch) return;

    const rawWord = wordMatch[1];

    const leadingPunctuationMatch = rawWord.match(/^[.,!?:;("'<\[{\-»«]+/);
    const leadingPunctuationLen = leadingPunctuationMatch ? leadingPunctuationMatch[0].length : 0;

    // Clean the word: strip leading and trailing punctuation
    const cleanWord = rawWord.replace(/^[.,!?:;("'<\[{\-»«]+|[.,!?:;)"'>\]}\-»«]+$/g, '');

    if (!this._shouldCheck(cleanWord)) return;

    // Calculate absolute document positions of the word
    const parentStart = $pos.start(); // absolute start of the parent node's content
    const wordEndInParent = $pos.parentOffset; // where the separator is
    const wordStartInParent = wordEndInParent - rawWord.length;
    const absoluteStart = parentStart + wordStartInParent + leadingPunctuationLen;
    const absoluteEnd = absoluteStart + cleanWord.length;

    // Get context (up to 10 words before and after)
    const contextBeforeRaw = doc.textBetween(Math.max(0, absoluteStart - 200), absoluteStart, ' ', '\ufffc');
    const contextAfterRaw = doc.textBetween(absoluteEnd, Math.min(doc.content.size, absoluteEnd + 200), ' ', '\ufffc');
    const contextBefore = contextBeforeRaw.trim().split(/\s+/).slice(-10).join(' ');
    const contextAfter = contextAfterRaw.trim().split(/\s+/).slice(0, 10).join(' ');

    // Skip if we recently corrected this exact word at this position
    const posKey = `${absoluteStart}:${cleanWord}`;
    if (this.recentlyCorrected.has(posKey)) return;

    // Debounce: wait a bit to let rapid typing settle
    clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this._correctWord(cleanWord, absoluteStart, absoluteEnd, posKey, contextBefore, contextAfter);
    }, DEBOUNCE_MS);
  }

  /**
   * Decides whether a cleaned word is eligible for correction.
   *
   * Rejects anything shorter than {@link MIN_WORD_LENGTH}, URLs and paths, mentions and hashtags,
   * pure numbers, all-caps abbreviations of 2–5 letters, and e-mail/domain-like tokens. These are
   * identifiers rather than prose, and "correcting" them would corrupt real content.
   *
   * @param {string} word Punctuation-stripped candidate word.
   * @returns {boolean} `true` when the word should be sent for correction.
   */
  _shouldCheck(word) {
    if (!word || word.length < MIN_WORD_LENGTH) return false;

    // Skip URLs and paths
    if (word.startsWith('http') || word.startsWith('www.') || word.includes('/')) return false;

    // Skip mentions and hashtags
    if (word.startsWith('@') || word.startsWith('#')) return false;

    // Skip pure numbers
    if (/^\d+$/.test(word)) return false;

    // Skip common abbreviations (all caps, 2-5 chars)
    if (/^[A-ZÄÖÜ]{2,5}$/.test(word)) return false;

    // Skip email-like patterns
    if (word.includes('@') || word.includes('.ch') || word.includes('.com')) return false;

    return true;
  }

  /**
   * Requests a correction for one word and applies it if it is still safe to do so.
   *
   * The model's answer is unquoted and trimmed, and a result identical to the input is discarded.
   * Before writing, the recorded range is re-read and must still contain exactly the original word —
   * this is what prevents a late response from clobbering text the user has since changed or deleted.
   * The edit is dispatched directly on the view with the `isSpellCheckerCorrection` meta flag, so it
   * neither steals focus nor re-triggers the bot. The position is then put under a 15 s cooldown and
   * a flash is drawn at the new range. Network failures are logged and swallowed; aborts are silent.
   *
   * @param {string} word Original word as it appears in the document.
   * @param {number} startPos Absolute start position of the word.
   * @param {number} endPos Absolute end position of the word.
   * @param {string} posKey Cooldown key (`startPos:word`) registered after a successful correction.
   * @param {string} contextBefore Up to 10 preceding words, for disambiguation.
   * @param {string} contextAfter Up to 10 following words, for disambiguation.
   * @returns {Promise<void>} Always resolves — errors are handled internally.
   */
  async _correctWord(word, startPos, endPos, posKey, contextBefore, contextAfter) {
    if (this.isDestroyed) return;

    try {
      const corrected = await this._callGemini(word, contextBefore, contextAfter);
      if (this.isDestroyed) return;

      // Clean the response (Gemini might add quotes or whitespace)
      const cleanCorrected = corrected.trim().replace(/^["'«»`]+|["'«»`]+$/g, '').trim();

      // Only apply if actually different
      if (!cleanCorrected || cleanCorrected === word) return;

      // Verify the word at this position hasn't changed while we waited for the API
      const { state } = this.editor;
      const docSize = state.doc.content.size;
      if (startPos < 0 || endPos > docSize) return;

      let currentText;
      try {
        currentText = state.doc.textBetween(startPos, endPos);
      } catch {
        return; // Position is no longer valid
      }

      if (currentText !== word) return; // Word changed — skip

      // Apply the correction without stealing focus from the user.
      const { tr } = this.editor.state;
      tr.insertText(cleanCorrected, startPos, endPos);
      tr.setMeta('isSpellCheckerCorrection', true);
      this.editor.view.dispatch(tr);

      // Mark as recently corrected to avoid re-checking
      this.recentlyCorrected.add(posKey);
      setTimeout(() => this.recentlyCorrected.delete(posKey), 15000);

      // Apply visual flash at correction site
      this._flashCorrection(startPos, startPos + cleanCorrected.length);

      console.log(`[SpellCheckerBot] ✅ "${word}" → "${cleanCorrected}"`);

    } catch (err) {
      if (err.name !== 'AbortError') {
        console.warn('[SpellCheckerBot] Correction failed:', err.message);
      }
    }
  }

  /**
   * Posts the word and its context to the backend `/api/spellcheck` proxy.
   *
   * The proxy holds the model credentials server-side, so the client never sees an API key; the
   * caller's Firebase ID token is attached as a bearer token. A missing token is not fatal — the
   * request is still attempted and the backend decides.
   *
   * @param {string} word Word to correct.
   * @param {string} contextBefore Preceding context.
   * @param {string} contextAfter Following context.
   * @returns {Promise<string>} The corrected word as returned by the backend (possibly still quoted
   *   or padded — the caller normalises it).
   * @throws {Error} If the proxy responds with a non-OK status; the message carries the status code
   *   and a truncated body.
   */
  async _callGemini(word, contextBefore, contextAfter) {
    let token = '';
    try {
      if (auth.currentUser) {
        token = await auth.currentUser.getIdToken();
      }
    } catch (e) {
      console.warn('[SpellCheckerBot] Failed to get auth token:', e);
    }

    const response = await fetch('/api/spellcheck', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        word,
        contextBefore,
        contextAfter
      })
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      throw new Error(`Spellcheck API ${response.status}: ${errorBody.substring(0, 200)}`);
    }

    const data = await response.json();
    return data.corrected;
  }

  /**
   * Draws a brief green flash over the corrected range so the change is noticeable but not intrusive.
   *
   * The flash is a fixed-position overlay appended to `document.body` — it never enters the editor
   * document, so it cannot be synced, undone, or exported. It removes itself on `animationend`, with
   * a 2 s timeout as a fallback for browsers that never fire the event. Failures are ignored: the
   * flash is decoration, and the correction itself has already been applied.
   *
   * @param {number} from Absolute start position of the corrected text.
   * @param {number} to Absolute end position of the corrected text.
   * @returns {void}
   */
  _flashCorrection(from, to) {
    try {
      const { view } = this.editor;
      const startCoords = view.coordsAtPos(from);
      const endCoords = view.coordsAtPos(to);

      const flash = document.createElement('div');
      flash.className = 'spellcheck-flash';
      flash.style.cssText = `
        position: fixed;
        left: ${startCoords.left}px;
        top: ${startCoords.top}px;
        width: ${Math.max(endCoords.right - startCoords.left, 20)}px;
        height: ${startCoords.bottom - startCoords.top}px;
        pointer-events: none;
        z-index: 999;
      `;
      document.body.appendChild(flash);

      flash.addEventListener('animationend', () => flash.remove());
      setTimeout(() => flash.remove(), 2000);
    } catch (e) {
      // Visual flash is non-critical
    }
  }

  /**
   * Stops the bot and releases everything it holds.
   *
   * Sets `isDestroyed` first so any in-flight correction aborts at its next checkpoint, then cancels
   * the pending debounce, detaches the transaction listener, and clears the cooldown set.
   *
   * @returns {void}
   */
  destroy() {
    this.isDestroyed = true;
    clearTimeout(this.debounceTimer);
    this.editor.off('transaction', this._onTransaction);
    this.recentlyCorrected.clear();
    console.log('[SpellCheckerBot] 🤖 Rechtschreib-Assistent deaktiviert');
  }
}
