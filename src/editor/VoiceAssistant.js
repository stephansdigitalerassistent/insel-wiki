/**
 * VoiceAssistant — Real-time voice input for Tiptap editor
 * Supports dictation, navigation, and formatting via Web Speech API.
 */

const insertPunctuation = (editor, punctuation) => {
  const { state } = editor;
  const { from } = state.selection;
  const textBefore = state.doc.textBetween(Math.max(0, from - 1), from);
  
  if (textBefore === ' ') {
    editor.chain().focus().deleteRange(from - 1, from).insertContentAt(from - 1, punctuation).run();
  } else {
    editor.chain().focus().insertContent(punctuation).run();
  }
};

const COMMANDS = {
  // Navigation
  'neuer absatz': (editor) => editor.chain().focus().enter().run(),
  'neue zeile': (editor) => editor.chain().focus().setHardBreak().run(),
  'löschen': (editor) => editor.chain().focus().deleteSelection().run(),
  'rückgängig': (editor) => editor.chain().focus().undo().run(),
  'wiederholen': (editor) => editor.chain().focus().redo().run(),

  // Formatting
  'fett': (editor) => editor.chain().focus().toggleBold().run(),
  'kursiv': (editor) => editor.chain().focus().toggleItalic().run(),
  'unterstrichen': (editor) => editor.chain().focus().toggleUnderline().run(),
  'überschrift eins': (editor) => editor.chain().focus().toggleHeading({ level: 1 }).run(),
  'überschrift zwei': (editor) => editor.chain().focus().toggleHeading({ level: 2 }).run(),
  'überschrift drei': (editor) => editor.chain().focus().toggleHeading({ level: 3 }).run(),
  'liste': (editor) => editor.chain().focus().toggleBulletList().run(),
  'nummerierung': (editor) => editor.chain().focus().toggleOrderedList().run(),
  'checkliste': (editor) => editor.chain().focus().toggleTaskList().run(),

  // Punctuation
  'punkt': (editor) => insertPunctuation(editor, '. '),
  'komma': (editor) => insertPunctuation(editor, ', '),
  'fragezeichen': (editor) => insertPunctuation(editor, '? '),
  'ausrufezeichen': (editor) => insertPunctuation(editor, '! '),
  'doppelpunkt': (editor) => insertPunctuation(editor, ': '),
  'semikolon': (editor) => insertPunctuation(editor, '; '),
};

export class VoiceAssistant {
  constructor(editor) {
    this.editor = editor;
    this.recognition = null;
    this.isRecording = false;
    this.onStateChange = null;
    this._networkErrorPending = false;
    this._recoveryRetryCount = 0;
    this._MAX_RECOVERY_RETRIES = 3;

    this._initRecognition();
  }

  _initRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn('[VoiceAssistant] Browser does not support Web Speech API.');
      return;
    }

    this.recognition = new SpeechRecognition();
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.lang = 'de-CH'; // Default to Swiss German as per project context

    this.recognition.onresult = (event) => {
      // Reset recovery counter on successful result
      this._recoveryRetryCount = 0;

      let interimTranscript = '';
      let finalTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript;
        } else {
          interimTranscript += event.results[i][0].transcript;
        }
      }

      if (finalTranscript) {
        this._handleFinalTranscript(finalTranscript.toLowerCase().trim());
      }
    };

    this.recognition.onstart = () => {
      console.log('[VoiceAssistant] Recording started...');
      // NOTE: do NOT reset _recoveryRetryCount here. `onstart` fires on every
      // recovery restart — even when the speech endpoint is blocked and the
      // session errors out milliseconds later. Resetting here would zero the
      // counter on each cycle and the retry cap would never trip (infinite
      // loop in restricted environments). The counter is only cleared by
      // `onresult`, which proves the endpoint actually responded.
    };

    this.recognition.onend = () => {
      console.log('[VoiceAssistant] Recording ended.');
      
      // If we are recovering from a network error, the setTimeout will handle the restart.
      if (this._networkErrorPending) {
        console.log('[VoiceAssistant] Network error recovery pending, skipping immediate restart.');
        return;
      }

      // Mobile Safari often ends the session unexpectedly. 
      // If we are still supposed to be recording, try to restart.
      if (this.isRecording && this.recognition) {
        console.log('[VoiceAssistant] Attempting to restart recognition...');
        try {
          this.recognition.start();
        } catch (e) {
          console.error('[VoiceAssistant] Auto-restart failed:', e);
          this.isRecording = false;
          if (this.onStateChange) this.onStateChange(false);
        }
      } else {
        this.isRecording = false;
        if (this.onStateChange) this.onStateChange(false);
      }
    };

    this.recognition.onerror = (event) => {
      console.error('[VoiceAssistant] Error occurred in recognition:', event.error);
      
      if (event.error === 'network' && this.isRecording) {
        if (this._recoveryRetryCount >= this._MAX_RECOVERY_RETRIES) {
          console.error('[VoiceAssistant] Max recovery retries reached. Stopping.');
          this.stop();
          return;
        }

        this._recoveryRetryCount++;
        console.warn(`[VoiceAssistant] Network error detected. Attempting recovery attempt ${this._recoveryRetryCount}/${this._MAX_RECOVERY_RETRIES} in 1s...`);
        this._networkErrorPending = true;

        // Wait a bit before retrying to avoid rapid failure loops
        setTimeout(() => {
          this._networkErrorPending = false;
          if (this.isRecording && this.recognition) {
            try {
              console.log('[VoiceAssistant] Recovery: Restarting recognition...');
              this.recognition.start();
            } catch (e) {
              // If it's already started (race condition), we can ignore it.
              if (e.name === 'InvalidStateError') {
                console.log('[VoiceAssistant] Recovery: Recognition already started, ignoring error.');
              } else {
                console.error('[VoiceAssistant] Recovery attempt failed:', e);
                this.stop();
              }
            }
          } else {
            console.log('[VoiceAssistant] Recovery: Recording was stopped or recognition nullified during wait.');
          }
        }, 1000);
      } else {
        console.log('[VoiceAssistant] Non-recoverable error or recording inactive. Stopping.');
        this.stop();
      }
    };
  }

  _handleFinalTranscript(transcript) {
    console.log('[VoiceAssistant] Final transcript:', transcript);

    // Normalize transcript for matching
    const normalized = transcript.toLowerCase().trim();

    // Check for commands (exact match or at the end of string for better UX)
    for (const [command, action] of Object.entries(COMMANDS)) {
      if (normalized === command || normalized.endsWith(' ' + command)) {
        console.log('[VoiceAssistant] Executing command:', command);
        action(this.editor);
        return;
      }
    }

    // Default: Insert text
    // Capitalize first letter if it's the start of a sentence or empty editor
    let textToInsert = transcript.trim();
    if (!textToInsert) return;

    const { state } = this.editor;
    const { selection } = state;
    const isStart = selection.from === 1 || state.doc.textBetween(selection.from - 2, selection.from).match(/[.!?]\s$/);
    
    if (isStart) {
      textToInsert = textToInsert.charAt(0).toUpperCase() + textToInsert.slice(1);
    }

    this.editor.chain().focus().insertContent(textToInsert + ' ').run();
  }

  toggle() {
    if (this.isRecording) {
      this.stop();
    } else {
      this.start();
    }
  }

  start() {
    if (this.recognition) {
      this.isRecording = true; // Set before starting to handle onend auto-restart
      if (this.onStateChange) this.onStateChange(true);
      try {
        this.recognition.start();
      } catch (e) {
        console.error('[VoiceAssistant] Failed to start recognition:', e);
        this.isRecording = false;
        if (this.onStateChange) this.onStateChange(false);
      }
    }
  }

  stop() {
    if (this.recognition && this.isRecording) {
      this.isRecording = false;
      if (this.onStateChange) this.onStateChange(false);
      this.recognition.stop();
    }
  }

  destroy() {
    this.stop();
    this.recognition = null;
  }
}
