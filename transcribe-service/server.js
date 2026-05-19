/**
 * insel-wiki transcribe-service — streaming speech-to-text proxy (Cloud Run).
 *
 *   browser ──WebSocket──▶ this service ──gRPC streamingRecognize──▶ Google STT
 *
 * Why a server-side proxy: the browser's Web Speech API streams mic audio to a
 * vendor endpoint that is blocked in restricted networks. Here the browser
 * only ever talks to the wiki's own origin (/api/transcribe, proxied to this
 * service by Firebase Hosting); the Google call happens server-side.
 *
 * Why streaming rather than chunked POSTs: streamingRecognize sees continuous
 * audio, so results break at natural pauses instead of arbitrary chunk edges —
 * no word-boundary clipping — and interim results arrive live.
 *
 * Protocol (one WebSocket connection):
 *   client → server  first frame: {"type":"auth","token":<idToken>,"lang":<bcp47>}
 *                     then binary WebM/Opus audio frames
 *                     {"type":"stop"} to flush remaining audio and finish
 *   server → client  {"type":"ready"}
 *                     {"type":"interim","transcript":...}
 *                     {"type":"final","transcript":...}
 *                     {"type":"error","message":...}
 *
 * Google's streamingRecognize caps one stream at ~5 min; on that limit the
 * service closes with code 4011 and the client transparently reconnects — a
 * fresh connection means a fresh MediaRecorder, hence a valid WebM header.
 */

const http = require('http');
const { WebSocketServer } = require('ws');
const admin = require('firebase-admin');
const { SpeechClient } = require('@google-cloud/speech');

admin.initializeApp();
const speechClient = new SpeechClient();

const PORT = process.env.PORT || 8080;
const DEFAULT_LANG = 'de-CH';
// A client that never sends the auth frame is dropped after this long.
const AUTH_TIMEOUT_MS = 5000;

// WebSocket close codes shared with the client (VoiceAssistant.js).
const CLOSE_AUTH = 4401; // bad/missing token — client must not retry
const CLOSE_LIMIT = 4011; // STT ~5-min limit — client reconnects transparently
const CLOSE_ERROR = 4500; // recognition failed — client reconnects, counts it

const server = http.createServer((req, res) => {
  // Cloud Run startup/liveness probes and any non-WebSocket hit land here.
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('transcribe-service\n');
});

const wss = new WebSocketServer({ server, maxPayload: 2 * 1024 * 1024 });

wss.on('connection', (ws) => {
  let recognizeStream = null;
  let authed = false;
  let stopped = false;

  const send = (obj) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
  };

  const authTimer = setTimeout(() => {
    if (!authed) ws.close(CLOSE_AUTH, 'Auth timeout');
  }, AUTH_TIMEOUT_MS);

  const startRecognize = (languageCode) => {
    recognizeStream = speechClient
      .streamingRecognize({
        config: {
          encoding: 'WEBM_OPUS',
          // MediaRecorder's Opus output is always 48 kHz; streamingRecognize
          // does not reliably read the rate from the WebM header, so it is
          // set explicitly (otherwise STT reports "Opus sample rate (0)").
          sampleRateHertz: 48000,
          // Primary language plus alternatives — STT detects which of these
          // the speaker is actually using, per utterance.
          languageCode,
          alternativeLanguageCodes: ['de-DE', 'en-US', 'fr-CH'],
          enableAutomaticPunctuation: true,
          // No explicit model: the specialised models are not offered for
          // de-CH, so the default model is used.
        },
        interimResults: true,
      })
      .on('data', (data) => {
        const result = data.results && data.results[0];
        const alt = result && result.alternatives && result.alternatives[0];
        if (!alt || !alt.transcript) return;
        send({ type: result.isFinal ? 'final' : 'interim', transcript: alt.transcript });
      })
      .on('error', (err) => {
        // code 11 (OUT_OF_RANGE) is the ~5-min single-stream limit.
        if (err.code === 11) {
          ws.close(CLOSE_LIMIT, 'Stream limit reached');
        } else {
          console.error('streamingRecognize error:', err.code, err.message);
          send({ type: 'error', message: 'Transcription failed' });
          ws.close(CLOSE_ERROR, 'Recognition error');
        }
      })
      .on('end', () => {
        // Reached after .end() has flushed the trailing finals post-stop.
        if (stopped && ws.readyState === ws.OPEN) ws.close(1000, 'Done');
      });
  };

  ws.on('message', async (data, isBinary) => {
    if (!authed) {
      // The first frame must be the JSON auth handshake.
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { msg = null; }
      if (!msg || msg.type !== 'auth' || !msg.token) {
        ws.close(CLOSE_AUTH, 'Expected auth frame');
        return;
      }
      try {
        await admin.auth().verifyIdToken(msg.token);
      } catch {
        ws.close(CLOSE_AUTH, 'Invalid auth token');
        return;
      }
      authed = true;
      clearTimeout(authTimer);
      startRecognize(typeof msg.lang === 'string' && msg.lang ? msg.lang : DEFAULT_LANG);
      send({ type: 'ready' });
      return;
    }

    if (isBinary) {
      if (recognizeStream && !recognizeStream.destroyed && !stopped) {
        recognizeStream.write(data);
      }
      return;
    }

    // Text frame after auth — only {"type":"stop"} is expected.
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }
    if (msg && msg.type === 'stop') {
      stopped = true;
      if (recognizeStream && !recognizeStream.destroyed) recognizeStream.end();
    }
  });

  ws.on('close', () => {
    clearTimeout(authTimer);
    if (recognizeStream && !recognizeStream.destroyed) {
      recognizeStream.removeAllListeners('error');
      recognizeStream.destroy();
    }
  });

  ws.on('error', () => { /* the decisive cleanup happens in the close handler */ });
});

server.listen(PORT, () => {
  console.log(`transcribe-service listening on ${PORT}`);
});
