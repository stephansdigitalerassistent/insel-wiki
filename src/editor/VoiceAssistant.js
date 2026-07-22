/**
 * @module editor/VoiceAssistant
 * @description
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

/**
 * Inserts a punctuation string at the caret, absorbing a single preceding space.
 *
 * Speech recognition emits words space-separated, so a spoken "komma" would otherwise land as
 * `wort ,`. When the character before the caret is a space it is deleted first, yielding `wort, `.
 *
 * @param {import('@tiptap/core').Editor} editor Target editor instance.
 * @param {string} punctuation Punctuation to insert, including its trailing space (e.g. `', '`).
 * @returns {void}
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

/**
 * German voice commands recognised in a final transcript, mapped to their editor action.
 *
 * A transcript matches when it *equals* a key or *ends with* ` <key>`, so "neuer absatz" fires the
 * command even when the recogniser prefixes it with earlier words. Matching happens on the
 * lowercased transcript; a match suppresses text insertion entirely.
 *
 * @type {Object<string, function(import('@tiptap/core').Editor): void>}
 */
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

/**
 * Backend WebSocket path — served same-origin via the Hosting `/api` rewrite.
 * @type {string}
 */
const TRANSCRIBE_PATH = '/api/transcribe';
/**
 * MediaRecorder emits a WebM/Opus blob this often; each is streamed as it lands.
 * @type {number}
 */
const TIMESLICE_MS = 250;
/**
 * Consecutive failed (re)connections tolerated before giving up. A clean handshake resets the count.
 * @type {number}
 */
const MAX_CONSECUTIVE_FAILURES = 3;
/**
 * WebSocket close code agreed with the service for an auth rejection — never retried.
 * @type {number}
 */
const CLOSE_AUTH = 4401;

/**
 * @class VoiceAssistant
 * @classdesc
 * Drives the microphone → WebSocket → Speech-to-Text pipeline described in the module header and
 * applies the results to a Tiptap editor.
 *
 * ### Session Lifecycle
 * `start()` validates browser support and auth, acquires the microphone, and calls `_openSession()`,
 * which authenticates a WebSocket with a Firebase ID token. Only once the service answers `ready`
 * does `_startRecorder()` begin streaming audio, so no audio is emitted before the backend can
 * accept it. `stop()` reverses this in order: it stops the recorder first, sends the `stop` signal
 * from the recorder's `onstop` handler (which fires *after* the last `ondataavailable`) so the tail
 * of the audio is not lost, then releases the microphone tracks.
 *
 * ### Reconnect Policy
 * The service caps one recognition stream at ~5 minutes, so an unexpected close is routine.
 * `_scheduleReconnect()` reopens the session with a linear backoff (300 ms × failure count) and
 * gives up after `MAX_CONSECUTIVE_FAILURES`. `_closingSession` distinguishes a deliberate teardown
 * from a drop, so a user-initiated stop never triggers a reconnect; a `CLOSE_AUTH` close is fatal
 * rather than retried.
 *
 * ### Result Handling
 * Interim results are forwarded to `onInterim` for the ghost-text preview only (see
 * {@link module:editor/VoiceGhost VoiceGhost}) and never touch the document. Final results go
 * through `_handleFinalTranscript()`, which first tries the {@link COMMANDS} table and otherwise
 * inserts the text, capitalising it when it starts a sentence.
 *
 * @property {import('@tiptap/core').Editor} editor Editor the transcript is applied to.
 * @property {string} lang BCP-47 recognition language sent with the auth frame (default `de-DE`).
 * @property {boolean} isRecording Whether a recording session is currently active. Also the guard
 *   that keeps async continuations from resuming a session the user already stopped.
 * @property {Function|null} onStateChange `(isRecording: boolean) => void` — UI recording indicator.
 * @property {Function|null} onError `(code: string, message: string) => void` — user-facing failure.
 * @property {Function|null} onInterim `(text: string, words: Array) => void` — optional live preview.
 * @property {MediaStream|null} _stream Active microphone stream; tracks are stopped on teardown.
 * @property {MediaRecorder|null} _recorder Recorder producing the WebM/Opus chunks.
 * @property {WebSocket|null} _ws Socket for the current recognition session.
 * @property {string|null} _mimeType Negotiated recording MIME type, or `null` if unsupported.
 * @property {number} _consecutiveFailures Failed (re)connections since the last successful handshake.
 * @property {any|null} _reconnectTimer Timer id for the pending reconnect attempt.
 * @property {boolean} _closingSession Set while a session is torn down on purpose, so the socket's
 *   close handler does not mistake it for a drop worth reconnecting.
 */
export class VoiceAssistant {
  /**
   * Creates a VoiceAssistant bound to an editor. No microphone or network access happens here —
   * call {@link VoiceAssistant#start start()} to begin a session.
   *
   * @param {import('@tiptap/core').Editor} editor Editor that receives transcripts and commands.
   */
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

  /**
   * Picks the best recording container the browser supports.
   *
   * @returns {string|null} `'audio/webm;codecs=opus'` (preferred, what the service decodes), plain
   *   `'audio/webm'` as a fallback, or `null` when MediaRecorder is missing or supports neither —
   *   which {@link VoiceAssistant#start start()} reports as an `unsupported` failure.
   */
  _pickMimeType() {
    if (typeof MediaRecorder === 'undefined') return null;
    return ['audio/webm;codecs=opus', 'audio/webm']
      .find((t) => MediaRecorder.isTypeSupported(t)) || null;
  }

  /**
   * Begins a recording session.
   *
   * Runs the preflight checks in order — MediaRecorder/getUserMedia support, WebSocket support, a
   * usable MIME type, a signed-in user — then requests microphone access and opens the first
   * recognition session. Any failed check routes through {@link VoiceAssistant#_fail _fail()} with a
   * distinct code (`unsupported`, `auth`, `mic-denied`) instead of throwing.
   *
   * Idempotent: calling it while already recording is a no-op.
   *
   * @returns {Promise<void>} Resolves once the session has been kicked off; recognition itself
   *   continues asynchronously.
   */
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

  /**
   * Opens one authenticated recognition session and wires up the socket handlers.
   *
   * Fetches a fresh Firebase ID token (re-checking `isRecording` afterwards, since the user may have
   * stopped while the token was in flight), connects, and sends the `auth` frame. Incoming frames:
   * `ready` resets the failure budget and starts the recorder, `interim` feeds `onInterim`, `final`
   * goes to {@link VoiceAssistant#_handleFinalTranscript _handleFinalTranscript()}, `error` is
   * logged. On close, a `CLOSE_AUTH` code fails permanently while any other unexpected close (a
   * network blip or the ~5-minute stream cap) schedules a transparent reconnect.
   *
   * Called by `start()` and by the reconnect timer; not part of the public API.
   *
   * @returns {Promise<void>}
   */
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

  /**
   * Starts streaming microphone audio over an already-ready socket.
   *
   * Each `TIMESLICE_MS` chunk is sent as a binary frame, guarded by a `readyState` check so chunks
   * produced during a close are dropped rather than throwing.
   *
   * @param {WebSocket} ws Socket that has completed the `ready` handshake.
   * @returns {void} Returns early if recording was stopped or the socket is no longer open;
   *   a MediaRecorder that cannot be constructed fails the session with the `recorder` code.
   */
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

  /**
   * Stops the current recorder and clears the reference.
   *
   * The reference is cleared *before* `stop()` so a late `ondataavailable` cannot resurrect it.
   * Errors from stopping an already-stopping recorder are ignored.
   *
   * @returns {void}
   */
  _stopRecorder() {
    const recorder = this._recorder;
    this._recorder = null;
    if (recorder && recorder.state !== 'inactive') {
      try { recorder.stop(); } catch { /* already stopping */ }
    }
  }

  /**
   * Queues a reconnect attempt after a dropped or unreachable session.
   *
   * Charges the attempt to the failure budget and backs off linearly (300 ms × failure count). Once
   * `MAX_CONSECUTIVE_FAILURES` is reached the session fails for good with the `backend` code; a
   * later successful handshake resets the counter.
   *
   * @param {string} message User-facing message used if the budget is exhausted.
   * @returns {void}
   */
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

  /**
   * Closes a socket if it is still open or connecting.
   *
   * @param {WebSocket|null} ws Socket to close; `null` and already-closed sockets are ignored.
   * @param {number} [code=1000] Close code; the default signals a normal shutdown.
   * @returns {void}
   */
  _closeWs(ws, code = 1000) {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      try { ws.close(code); } catch { /* ignore */ }
    }
  }

  /**
   * Applies a finalised transcript to the editor — as a command if it matches one, else as text.
   *
   * Command matching runs on the lowercased transcript against {@link COMMANDS} and returns early on
   * a hit, so a spoken command is never also inserted as text. Otherwise the transcript is inserted
   * verbatim (original casing) with a trailing space, capitalised when it opens the document or
   * follows sentence-ending punctuation.
   *
   * @param {string} transcript Final transcript from the recognition service.
   * @param {Array} [words=[]] Per-word metadata from the service; accepted for API symmetry with the
   *   interim callback and currently unused.
   * @returns {void}
   */
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

  /**
   * Starts recording if idle, stops it if running — the handler behind the microphone button.
   *
   * @returns {void}
   */
  toggle() {
    if (this.isRecording) {
      this.stop();
    } else {
      this.start();
    }
  }

  /**
   * Ends the recording session cleanly.
   *
   * Marks the teardown as deliberate (so the socket's close handler will not reconnect), cancels any
   * pending reconnect, and stops the recorder. The `stop` frame is sent from the recorder's `onstop`
   * handler — which fires after the final `ondataavailable` — so the service receives the last audio
   * chunk before being told to flush recognition; if the recorder cannot be stopped the socket is
   * closed directly. Finally the microphone tracks are released and `onStateChange(false)` fires.
   *
   * Safe to call when not recording: it just runs a teardown to clear any lingering resources.
   *
   * @returns {void}
   */
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

  /**
   * Stops every microphone track and drops the stream, turning off the browser's recording
   * indicator.
   *
   * @returns {void}
   */
  _releaseStream() {
    if (this._stream) {
      this._stream.getTracks().forEach((t) => t.stop());
      this._stream = null;
    }
  }

  /**
   * Releases every resource unconditionally: pending reconnect timer, recorder, socket, microphone.
   *
   * Unlike {@link VoiceAssistant#stop stop()} this performs no graceful flush — it is the last-resort
   * cleanup used on destroy and when `stop()` is called on an already-idle instance.
   *
   * @returns {void}
   */
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

  /**
   * Reports a fatal session error and shuts the session down.
   *
   * @param {string} code Machine-readable cause: `unsupported`, `auth`, `mic-denied`, `recorder`,
   *   or `backend`. The UI maps it to an appropriate hint.
   * @param {string} message German, user-facing description passed to `onError`.
   * @returns {void}
   */
  _fail(code, message) {
    console.error(`[VoiceAssistant] ${code}: ${message}`);
    if (this.onError) this.onError(code, message);
    this.stop();
  }

  /**
   * Permanently disposes the assistant — call when the editor is unmounted.
   *
   * Marks the shutdown as deliberate, stops any active session, and force-releases the remaining
   * resources so no reconnect fires and the microphone is never left open.
   *
   * @returns {void}
   */
  destroy() {
    this._closingSession = true;
    this.stop();
    this._teardown();
  }
}
