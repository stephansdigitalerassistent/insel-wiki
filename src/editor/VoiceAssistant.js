/**
 * VoiceAssistant — Voice input for the Tiptap editor.
 *
 * Recognition runs through the wiki's OWN backend, not the browser's Web
 * Speech API (whose vendor speech endpoint is blocked in restricted networks):
 *
 *   mic → MediaRecorder (WebM/Opus) → WebSocket /api/transcribe
 *       → Cloud Run service → Google Speech-to-Text (streaming) → transcript
 *
 * The only network call the browser makes is to the wiki's own origin (already
 * reachable — the wiki loaded), so the restricted block is bypassed.
 *
 * Streaming (vs. the earlier chunked POSTs): Speech-to-Text sees a continuous
 * audio stream, so results break at natural pauses instead of arbitrary chunk
 * edges — no word-boundary clipping. Final results drive editor insertion and
 * commands; interim results are surfaced via the optional onInterim callback
 * for a live preview, but are not inserted into the document.
 *
 * The service caps a single recognition stream at ~5 min; when it closes for
 * that reason the client transparently opens a fresh session and keeps going.
 */

import { auth } from '../firebase/config.js';

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

// Backend WebSocket — served same-origin via the Hosting /api rewrite.
const TRANSCRIBE_PATH = '/api/transcribe';
// MediaRecorder emits a WebM/Opus blob this often; each is streamed as it lands.
const TIMESLICE_MS = 250;
// Consecutive failed (re)connections tolerated before giving up.
const MAX_CONSECUTIVE_FAILURES = 3;
// WebSocket close code agreed with the service for an auth rejection.
const CLOSE_AUTH = 4401;

export class VoiceAssistant {
  constructor(editor) {
    this.editor = editor;
    this.lang = 'de-DE';
    this.isRecording = false;
    this.onStateChange = null; // (isRecording: boolean) => void
    this.onError = null;       // (code: string, message: string) => void
    this.onInterim = null;     // (text: string) => void — optional live preview

    this._stream = null;
    this._recorder = null;
    this._ws = null;
    this._mimeType = null;
    this._consecutiveFailures = 0;
    this._reconnectTimer = null;
    // Set while a session is being torn down on purpose, so the socket's
    // close handler does not mistake it for a drop worth reconnecting.
    this._closingSession = false;
  }

  _pickMimeType() {
    if (typeof MediaRecorder === 'undefined') return null;
    return ['audio/webm;codecs=opus', 'audio/webm']
      .find((t) => MediaRecorder.isTypeSupported(t)) || null;
  }

  async start() {
    if (this.isRecording) return;

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      this._fail('unsupported', 'Mikrofonzugriff wird von diesem Browser nicht unterstützt.');
      return;
    }
    if (typeof WebSocket === 'undefined') {
      this._fail('unsupported', 'WebSockets werden von diesem Browser nicht unterstützt.');
      return;
    }
    this._mimeType = this._pickMimeType();
    if (!this._mimeType) {
      this._fail('unsupported', 'Audioaufnahme (WebM/Opus) wird von diesem Browser nicht unterstützt.');
      return;
    }
    if (!auth.currentUser) {
      this._fail('auth', 'Bitte zuerst anmelden, um die Spracheingabe zu nutzen.');
      return;
    }

    try {
      this._stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      console.error('[VoiceAssistant] Microphone access denied:', e);
      this._fail('mic-denied', 'Kein Zugriff auf das Mikrofon.');
      return;
    }

    this.isRecording = true;
    this._consecutiveFailures = 0;
    if (this.onStateChange) this.onStateChange(true);
    console.log('[VoiceAssistant] Recording started (streaming).');
    this._openSession();
  }

  async _openSession() {
    if (!this.isRecording || !this._stream) return;

    let token;
    try {
      token = await auth.currentUser.getIdToken();
    } catch (e) {
      console.error('[VoiceAssistant] Could not obtain auth token:', e);
      this._fail('auth', 'Sitzung abgelaufen — bitte neu anmelden.');
      return;
    }
    // start()/stop() may have changed state while the token was being fetched.
    if (!this.isRecording) return;

    const wsUrl = 'wss://transcribe-485637054444.europe-west1.run.app/api/transcribe';
    let ws;
    try {
      ws = new WebSocket(wsUrl);
    } catch (e) {
      console.error('[VoiceAssistant] Could not open WebSocket:', e);
      this._scheduleReconnect('Spracherkennungs-Dienst nicht erreichbar.');
      return;
    }
    this._ws = ws;
    this._closingSession = false;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'auth', token, lang: this.lang }));
    };

    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }

      if (msg.type === 'ready') {
        this._consecutiveFailures = 0; // a clean handshake resets the budget
        this._startRecorder(ws);
      } else if (msg.type === 'interim') {
        if (this.onInterim) this.onInterim(msg.transcript || '', msg.words || []);
      } else if (msg.type === 'final') {
        const transcript = (msg.transcript || '').trim();
        // Don't clear the interim preview immediately if we have a final transcript
        // to process. The editor insertion will handle the state transition.
        if (transcript) {
          this._handleFinalTranscript(transcript, msg.words || []);
          // Only clear interim if we've successfully handled the final
          if (this.onInterim) this.onInterim('', []);
        } else {
          if (this.onInterim) this.onInterim('', []);
        }
      } else if (msg.type === 'error') {
        console.error('[VoiceAssistant] Backend error:', msg.message);
      }
    };

    ws.onerror = () => {
      // onclose carries the decisive signal (and a code); just log here.
      console.error('[VoiceAssistant] WebSocket error.');
    };

    ws.onclose = (ev) => {
      if (this._ws === ws) this._ws = null;
      this._stopRecorder();
      if (!this.isRecording || this._closingSession) return;

      if (ev.code === CLOSE_AUTH) {
        this._fail('auth', 'Nicht autorisiert für die Spracheingabe.');
        return;
      }
      // Unexpected drop — a network blip or the service's ~5-min stream limit.
      // Reconnect transparently; a reconnect that itself fails counts toward
      // the failure budget, a successful one ('ready') resets it.
      console.log('[VoiceAssistant] Session closed, reconnecting…');
      this._scheduleReconnect('Spracherkennungs-Dienst nicht erreichbar.');
    };
  }

  _startRecorder(ws) {
    if (!this.isRecording || ws.readyState !== WebSocket.OPEN) return;

    let recorder;
    try {
      recorder = new MediaRecorder(this._stream, { mimeType: this._mimeType });
    } catch (e) {
      console.error('[VoiceAssistant] Failed to create MediaRecorder:', e);
      this._fail('recorder', 'Audioaufnahme konnte nicht gestartet werden.');
      return;
    }
    this._recorder = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0 && ws.readyState === WebSocket.OPEN) {
        ws.send(e.data);
      }
    };
    recorder.start(TIMESLICE_MS);
  }

  _stopRecorder() {
    const recorder = this._recorder;
    this._recorder = null;
    if (recorder && recorder.state !== 'inactive') {
      try { recorder.stop(); } catch { /* already stopping */ }
    }
  }

  _scheduleReconnect(message) {
    this._consecutiveFailures++;
    if (this._consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      console.error('[VoiceAssistant] Too many consecutive failures. Stopping.');
      this._fail('backend', message);
      return;
    }
    const delay = 300 * this._consecutiveFailures;
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this._openSession();
    }, delay);
  }

  _closeWs(ws, code = 1000) {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      try { ws.close(code); } catch { /* ignore */ }
    }
  }

  _handleFinalTranscript(transcript, words = []) {
    console.log('[VoiceAssistant] Final transcript:', transcript);

    // Normalize for command matching only — inserted text keeps its casing.
    const normalized = transcript.toLowerCase().trim();

    for (const [command, action] of Object.entries(COMMANDS)) {
      if (normalized === command || normalized.endsWith(' ' + command)) {
        console.log('[VoiceAssistant] Executing command:', command);
        action(this.editor);
        return;
      }
    }

    let textToInsert = transcript.trim();
    if (!textToInsert) return;

    // Capitalize the first letter at the start of a sentence / empty editor.
    const { state } = this.editor;
    const { selection } = state;
    const isStart = selection.from === 1
      || state.doc.textBetween(selection.from - 2, selection.from).match(/[.!?]\s$/);

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

  stop() {
    if (!this.isRecording) {
      this._teardown();
      return;
    }
    this.isRecording = false;
    this._closingSession = true;

    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }

    const ws = this._ws;
    const recorder = this._recorder;
    this._recorder = null;

    if (recorder && recorder.state !== 'inactive') {
      // onstop fires after the final ondataavailable, so the service gets the
      // last audio blob before the stop signal that flushes recognition.
      recorder.onstop = () => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'stop' }));
        }
      };
      try {
        recorder.stop();
      } catch {
        this._closeWs(ws);
      }
    } else {
      this._closeWs(ws);
    }

    this._releaseStream();
    console.log('[VoiceAssistant] Recording stopped.');
    if (this.onStateChange) this.onStateChange(false);
  }

  _releaseStream() {
    if (this._stream) {
      this._stream.getTracks().forEach((t) => t.stop());
      this._stream = null;
    }
  }

  _teardown() {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    this._stopRecorder();
    this._closeWs(this._ws);
    this._ws = null;
    this._releaseStream();
  }

  _fail(code, message) {
    console.error(`[VoiceAssistant] ${code}: ${message}`);
    if (this.onError) this.onError(code, message);
    this.stop();
  }

  destroy() {
    this._closingSession = true;
    this.stop();
    this._teardown();
  }
}
