// SpellCheckerBot — AI-powered word-level spell checker using Gemini 3.1 Flash Lite
// Silently corrects dyslexia-typical spelling errors as the user types.


const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;
const GEMINI_MODEL = 'gemini-3.1-flash-lite-preview';
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

// Characters that signal "the previous word is finished"
const WORD_SEPARATORS = new Set([' ', '.', ',', '!', '?', ':', ';', '\n', ')', ']', '}', '–', '—', '"', '»']);

// Minimum word length to consider for correction
const MIN_WORD_LENGTH = 3;

// Debounce time after a word separator is typed (ms)
const DEBOUNCE_MS = 500;

// Bot identity for the collaboration cursor
const BOT_NAME = '🤖 Rechtschreib-Assistent';
const BOT_COLOR = '#10b981'; // Emerald green

// System prompt for Gemini — optimized for token efficiency & dyslexia corrections
const SYSTEM_PROMPT = `Fix dyslexia typos (transpositions, omissions, duplicates, b/d/p/q/ei/ie swaps).
Output ONLY corrected word. No punctuation, quotes, or explanation.
If correct, output as is.
Keep original case.
Keep German umlauts (ä,ö,ü). Do NOT replace with ae/oe/ue.
Use Swiss German (replace 'ß' with 'ss').
Ignore medical terms, acronyms, names.
Lang: DE/EN.`;

export class SpellCheckerBot {
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
   * Start listening for word completions
   */
  start() {
    if (!GEMINI_API_KEY || GEMINI_API_KEY === 'YOUR_GEMINI_API_KEY_HERE') {
      console.warn('[SpellCheckerBot] No VITE_GEMINI_API_KEY set — spell check disabled.');
      return;
    }

    console.log('[SpellCheckerBot] 🤖 Rechtschreib-Assistent aktiviert');
    this.editor.on('transaction', this._onTransaction);
  }

  /**
   * Called on every editor transaction — detects finished words
   */
  _onTransaction({ transaction }) {
    if (this.isDestroyed) return;
    if (!transaction.docChanged) return;

    // Use the mapped selection position after the transaction to find what was just typed.
    const { selection } = this.editor.state;
    const cursorPos = selection.from;

    if (cursorPos < 2) return;

    const charBefore = this.editor.state.doc.textBetween(cursorPos - 1, cursorPos);

    // Only proceed if a word separator was just typed
    if (!WORD_SEPARATORS.has(charBefore)) return;

    // Extract and queue the word before the separator
    this._extractAndQueueWord(cursorPos - 1);
  }

  /**
   * Extract the word that just ended at the given position (position of the separator)
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

    // Clean the word: strip trailing punctuation
    const cleanWord = rawWord.replace(/[.,!?:;)"'»\]}/]+$/, '');

    if (!this._shouldCheck(cleanWord)) return;

    // Calculate absolute document positions of the word
    const parentStart = $pos.start(); // absolute start of the parent node's content
    const wordEndInParent = $pos.parentOffset; // where the separator is
    const wordStartInParent = wordEndInParent - rawWord.length;
    const absoluteStart = parentStart + wordStartInParent;
    const absoluteEnd = absoluteStart + cleanWord.length;

    // Skip if we recently corrected this exact word at this position
    const posKey = `${absoluteStart}:${cleanWord}`;
    if (this.recentlyCorrected.has(posKey)) return;

    // Debounce: wait a bit to let rapid typing settle
    clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this._correctWord(cleanWord, absoluteStart, absoluteEnd, posKey);
    }, DEBOUNCE_MS);
  }

  /**
   * Determine if a word should be spell-checked
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
   * Send a word to Gemini for correction and apply the result
   */
  async _correctWord(word, startPos, endPos, posKey) {
    if (this.isDestroyed) return;

    try {
      const corrected = await this._callGemini(word);
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
   * Call Gemini 3.1 Flash Lite API for word correction
   */
  async _callGemini(word) {
    const response = await fetch(GEMINI_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: {
          parts: [{ text: SYSTEM_PROMPT }]
        },
        contents: [{
          parts: [{ text: word }]
        }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 30,
          candidateCount: 1
        }
      })
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      throw new Error(`Gemini API ${response.status}: ${errorBody.substring(0, 200)}`);
    }

    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
      throw new Error('No text in Gemini response');
    }

    return text;
  }

  /**
   * Apply a brief green flash animation at the correction site
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
   * Stop the spell checker and clean up
   */
  destroy() {
    this.isDestroyed = true;
    clearTimeout(this.debounceTimer);
    this.editor.off('transaction', this._onTransaction);
    this.recentlyCorrected.clear();
    console.log('[SpellCheckerBot] 🤖 Rechtschreib-Assistent deaktiviert');
  }
}
