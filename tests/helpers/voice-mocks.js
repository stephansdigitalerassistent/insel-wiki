/**
 * Browser-side mocks for VoiceAssistant's streaming backend.
 *
 * VoiceAssistant captures mic audio with getUserMedia + MediaRecorder and
 * streams it to /api/transcribe over a WebSocket. These mocks replace all
 * three so tests can drive transcription deterministically — no real
 * microphone, MediaRecorder, or backend service required.
 *
 * Inject once per page, before app code runs and before navigation:
 *
 *   import { installVoiceMocks } from './helpers/voice-mocks.js';
 *   await page.addInitScript(installVoiceMocks);                 // defaults
 *   await page.addInitScript(installVoiceMocks, { rejectAuth: true });
 *
 * Then drive it from the test through window.__voice:
 *
 *   await page.evaluate(() => window.__voice.final('hallo welt'));
 *
 * Options:
 *   rejectAuth        — backend rejects the auth handshake (closes 4401)
 *   failGetUserMedia  — getUserMedia rejects (microphone permission denied)
 *   noMediaRecorder   — simulate a browser without MediaRecorder support
 *   serverDown        — every connection drops right after the auth frame,
 *                       so reconnect attempts keep failing
 */
export function installVoiceMocks(options = {}) {
  const state = {
    sockets: [],
    recorders: [],
    rejectAuth: false,
    failGetUserMedia: false,
    noMediaRecorder: false,
    serverDown: false,
  };
  Object.assign(state, options);
  window.__voiceState = state;

  const activeOpenSocket = () => {
    for (let i = state.sockets.length - 1; i >= 0; i--) {
      if (state.sockets[i].readyState === 1) return state.sockets[i];
    }
    return null;
  };

  // --- Fake WebSocket -------------------------------------------------------
  class FakeWebSocket {
    constructor(url) {
      this.url = url;
      this.readyState = 0; // CONNECTING
      this.CONNECTING = 0; this.OPEN = 1; this.CLOSING = 2; this.CLOSED = 3;
      this.onopen = null; this.onmessage = null; this.onerror = null; this.onclose = null;
      this.sent = [];
      state.sockets.push(this);
      setTimeout(() => {
        if (this.readyState !== 0) return;
        this.readyState = 1;
        if (this.onopen) this.onopen({});
      }, 5);
    }

    send(data) {
      this.sent.push(data);
      if (typeof data !== 'string') return; // binary audio frame — just recorded
      let msg;
      try { msg = JSON.parse(data); } catch { return; }
      if (msg.type === 'auth') {
        if (state.rejectAuth) this._serverClose(4401, 'Invalid auth token');
        else if (state.serverDown) this._serverClose(1006, 'Server down');
        else this._deliver({ type: 'ready' });
      } else if (msg.type === 'stop') {
        this._serverClose(1000, 'Done'); // the real service flushes and closes
      }
    }

    close(code) {
      if (this.readyState === 3) return;
      this.readyState = 3;
      if (this.onclose) this.onclose({ code: code || 1000, reason: '' });
    }

    // --- test-side controls (prefixed _ so they are clearly not WS API) ---
    _deliver(obj) {
      if (this.readyState === 1 && this.onmessage) {
        this.onmessage({ data: JSON.stringify(obj) });
      }
    }

    _serverClose(code, reason) {
      if (this.readyState === 3) return;
      this.readyState = 3;
      if (this.onclose) this.onclose({ code, reason: reason || '' });
    }
  }
  FakeWebSocket.CONNECTING = 0;
  FakeWebSocket.OPEN = 1;
  FakeWebSocket.CLOSING = 2;
  FakeWebSocket.CLOSED = 3;
  window.WebSocket = FakeWebSocket;

  // --- Fake MediaRecorder ---------------------------------------------------
  class FakeMediaRecorder {
    static isTypeSupported(type) { return /audio\/webm/.test(type); }

    constructor(stream, opts) {
      this.stream = stream;
      this.mimeType = (opts && opts.mimeType) || 'audio/webm';
      this.state = 'inactive';
      this.ondataavailable = null;
      this.onstop = null;
      this._timer = null;
      state.recorders.push(this);
    }

    start(timeslice) {
      this.state = 'recording';
      // Emit a non-empty blob each timeslice, mimicking continuous capture.
      this._timer = setInterval(() => {
        if (this.ondataavailable) {
          this.ondataavailable({ data: new Blob(['audio'], { type: this.mimeType }) });
        }
      }, timeslice || 250);
    }

    stop() {
      if (this.state === 'inactive') return;
      this.state = 'inactive';
      if (this._timer) { clearInterval(this._timer); this._timer = null; }
      if (this.ondataavailable) {
        this.ondataavailable({ data: new Blob(['final'], { type: this.mimeType }) });
      }
      if (this.onstop) this.onstop();
    }
  }
  window.MediaRecorder = state.noMediaRecorder ? undefined : FakeMediaRecorder;

  // --- Fake getUserMedia ----------------------------------------------------
  const fakeStream = { getTracks: () => [{ stop() {} }] };
  const getUserMedia = () => (state.failGetUserMedia
    ? Promise.reject(new DOMException('Permission denied', 'NotAllowedError'))
    : Promise.resolve(fakeStream));
  try {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      get: () => ({ getUserMedia }),
    });
  } catch {
    if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = getUserMedia;
  }

  // --- Test API -------------------------------------------------------------
  window.__voice = {
    // True once a session is fully established (socket open + recorder running).
    ready: () => activeOpenSocket() !== null
      && state.recorders.some((r) => r.state === 'recording'),
    socketCount: () => state.sockets.length,
    recorderActive: () => state.recorders.some((r) => r.state === 'recording'),
    // How many binary audio frames have reached the backend across all sockets.
    audioFramesSent: () => state.sockets.reduce(
      (n, s) => n + s.sent.filter((d) => typeof d !== 'string').length, 0),
    // Drive recognition results to the client.
    final: (text) => { const s = activeOpenSocket(); if (s) s._deliver({ type: 'final', transcript: text }); },
    interim: (text) => { const s = activeOpenSocket(); if (s) s._deliver({ type: 'interim', transcript: text }); },
    serverError: (m) => { const s = activeOpenSocket(); if (s) s._deliver({ type: 'error', message: m || 'failed' }); },
    // Simulate an unexpected drop (network blip, or the STT ~5-min limit).
    drop: (code) => { const s = activeOpenSocket(); if (s) s._serverClose(code || 1006, 'drop'); },
  };
}
