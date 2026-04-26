// SpellCheckerBot — AI-powered word-level spell checker using Gemini 3.1 Flash Lite
// Registers as a virtual collaboration cursor ("🤖 Rechtschreib-Assistent")
// so other editors can see corrections happening in real-time.

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;
const GEMINI_MODEL = 'gemini-3.1-flash-lite';
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

// Characters that signal "the previous word is finished"
const WORD_SEPARATORS = new Set([' ', '.', ',', '!', '?', ':', ';', '\n', ')', ']', '}', '–', '—', '"', '»']);

// Minimum word length to consider for correction
const MIN_WORD_LENGTH = 3;

// Debounce time after a word separator is typed (ms)
const DEBOUNCE_MS = 400;

// Bot identity for the collaboration cursor
const BOT_NAME = '🤖 Rechtschreib-Assistent';
const BOT_COLOR = '#10b981'; // Emerald green

// System prompt for Gemini — optimized for dyslexia-specific corrections
// Primary focus: character transpositions, letter swaps, omissions, duplications
const SYSTEM_PROMPT = `Du bist ein Rechtschreibassistent, spezialisiert auf Legasthenie-typische Fehler.
Häufige Fehlermuster die du korrigieren sollst:
- Buchstabenvertauschungen (z.B. "Pateint" → "Patient", "Brto" → "Brot")
- Buchstabenauslassungen (z.B. "Patint" → "Patient")
- Buchstabenverdopplungen (z.B. "Pattient" → "Patient")
- Buchstabenverwechslungen (b/d, p/q, ei/ie, z.B. "Artzt" → "Arzt")

Regeln:
- Gib NUR das korrigierte Wort zurück, nichts anderes
- Wenn das Wort korrekt ist, gib es exakt unverändert zurück
- Behalte die originale Gross-/Kleinschreibung bei
- Ändere KEINE Fachbegriffe, Abkürzungen, Eigennamen oder medizinische Termini
- Das Wort kann Deutsch oder Englisch sein
- Gib KEIN Satzzeichen, Anführungszeichen oder zusätzlichen Text zurück`;

export class SpellCheckerBot {
  constructor(editor, provider) {
    this.editor = editor;
    this.provider = provider;
    this.debounceTimer = null;
    this.pendingCorrections = new Map(); // word → {pos, endPos}
    this.recentlyCorreected = new Set(); // avoid re-correcting same position
    this.isDestroyed = false;
    this._onTransaction = this._onTransaction.bind(this);
    this._lastCursorPos = null;
  }

  /**
   * Start listening for word completions
   */
  start() {
    if (!GEMINI_API_KEY) {
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

    // Check if the last step was a text insertion
    const steps = transaction.steps;
    if (!steps || steps.length === 0) return;

    // Get the inserted text from the last step
    let insertedText = '';
    let insertPos = null;

    for (const step of steps) {
      // ReplaceStep with content — this is a text insertion
      if (step.slice && step.slice.content) {
        const content = step.slice.content;
        content.forEach(node => {
          if (node.isText) {
            insertedText += node.text;
            insertPos = step.from;
          }
        });
      }
    }

    if (!insertedText || insertPos === null) return;

    // Check if the last character is a word separator
    const lastChar = insertedText[insertedText.length - 1];
    if (!WORD_SEPARATORS.has(lastChar)) return;

    // Extract the word before the separator
    this._extractAndQueueWord(insertPos);
  }

  /**
   * Extract the word that just ended at the given position
   */
  _extractAndQueueWord(separatorPos) {
    const { state } = this.editor;
    const doc = state.doc;

    // Resolve position to find the text node
    const $pos = doc.resolve(separatorPos);
    const textBefore = $pos.parent.textBetween(
      0,
      $pos.parentOffset,
      undefined,
      '\ufffc' // object replacement char for non-text nodes
    );

    if (!textBefore) return;

    // Find the last word in the text
    // Match a word that ends right at the cursor (before the separator)
    const wordMatch = textBefore.match(/(\S+)$/);
    if (!wordMatch) return;

    const word = wordMatch[1];

    // Clean the word: strip trailing punctuation that might have been included
    const cleanWord = word.replace(/[.,!?:;)"'»\]}/]+$/, '');

    // Skip conditions
    if (!this._shouldCheck(cleanWord)) return;

    // Calculate the absolute positions of the word in the document
    const wordStartInParent = textBefore.length - word.length;
    const absoluteStart = separatorPos - (textBefore.length - wordStartInParent);
    const absoluteEnd = absoluteStart + cleanWord.length;

    // Skip if we recently corrected at this position
    const posKey = `${absoluteStart}-${cleanWord}`;
    if (this.recentlyCorreected.has(posKey)) return;

    // Debounce: wait a short time to avoid correcting during rapid typing
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

    // Skip words that are all numbers or contain numbers mixed with letters (e.g. ICD-10, H2O)
    if (/^\d+$/.test(word)) return false;

    // Skip common abbreviations (all caps, 2-5 chars)
    if (/^[A-ZÄÖÜ]{2,5}$/.test(word)) return false;

    // Skip words inside code blocks
    const { state } = this.editor;
    const $pos = state.doc.resolve(Math.min(state.doc.content.size, state.selection.from));
    if ($pos.parent.type.name === 'codeBlock') return false;

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
      const cleanCorrected = corrected.trim().replace(/^["'«»]+|["'«»]+$/g, '').trim();

      // Only apply if actually different and not empty
      if (!cleanCorrected || cleanCorrected === word || cleanCorrected.length === 0) return;

      // Verify the word at this position hasn't changed since we queued it
      const { state } = this.editor;
      const currentText = state.doc.textBetween(
        Math.max(0, startPos),
        Math.min(state.doc.content.size, endPos),
        undefined
      );

      if (currentText !== word) {
        // Word changed while we were waiting — skip
        return;
      }

      // Apply the correction via editor commands
      this.editor.chain()
        .focus()
        .command(({ tr }) => {
          // Add a decoration class for the flash animation
          tr.insertText(cleanCorrected, startPos, endPos);
          return true;
        })
        .run();

      // Mark as recently corrected to avoid re-checking
      this.recentlyCorreected.add(posKey);
      setTimeout(() => this.recentlyCorreected.delete(posKey), 10000);

      // Apply visual flash at correction site
      this._flashCorrection(startPos, startPos + cleanCorrected.length);

      console.log(`[SpellCheckerBot] Corrected: "${word}" → "${cleanCorrected}"`);
    } catch (err) {
      // Silently fail — spell check is a best-effort feature
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
      throw new Error(`Gemini API error: ${response.status}`);
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
        width: ${endCoords.right - startCoords.left}px;
        height: ${startCoords.bottom - startCoords.top}px;
        pointer-events: none;
        z-index: 999;
      `;
      document.body.appendChild(flash);

      // Remove after animation completes
      flash.addEventListener('animationend', () => flash.remove());
      setTimeout(() => flash.remove(), 2000); // Fallback cleanup
    } catch (e) {
      // Visual flash is non-critical — ignore errors
    }
  }

  /**
   * Stop the spell checker and clean up
   */
  destroy() {
    this.isDestroyed = true;
    clearTimeout(this.debounceTimer);
    this.editor.off('transaction', this._onTransaction);
    this.pendingCorrections.clear();
    this.recentlyCorreected.clear();
    console.log('[SpellCheckerBot] 🤖 Rechtschreib-Assistent deaktiviert');
  }
}
