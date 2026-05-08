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
      this.isRecording = true;
      if (this.onStateChange) this.onStateChange(true);
      console.log('[VoiceAssistant] Recording started...');
    };

    this.recognition.onend = () => {
      this.isRecording = false;
      if (this.onStateChange) this.onStateChange(false);
      console.log('[VoiceAssistant] Recording ended.');
    };

    this.recognition.onerror = (event) => {
      console.error('[VoiceAssistant] Error occurred in recognition: ', event.error);
      this.stop();
    };
  }

  _handleFinalTranscript(transcript) {
    console.log('[VoiceAssistant] Final transcript:', transcript);

    // Check for commands
    if (COMMANDS[transcript]) {
      console.log('[VoiceAssistant] Executing command:', transcript);
      COMMANDS[transcript](this.editor);
      return;
    }

    // Default: Insert text
    // Capitalize first letter if it's the start of a sentence or empty editor
    let textToInsert = transcript;
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
    if (this.recognition && !this.isRecording) {
      try {
        this.recognition.start();
      } catch (e) {
        console.error('[VoiceAssistant] Failed to start recognition:', e);
      }
    }
  }

  stop() {
    if (this.recognition && this.isRecording) {
      this.recognition.stop();
    }
  }

  destroy() {
    this.stop();
    this.recognition = null;
  }
}
