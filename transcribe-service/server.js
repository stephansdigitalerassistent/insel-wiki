/**
 * insel-wiki transcribe-service — streaming speech-to-text proxy (Cloud Run).
 *
 * Upgraded to Google Speech-to-Text V2 & Chirp foundation models (chirp_2 / chirp_3).
 *
 *   browser ──WebSocket──▶ this service ──gRPC streamingRecognize──▶ Google STT (Chirp / V2)
 *
 * Why a server-side proxy: the browser's Web Speech API streams mic audio to a
 * vendor endpoint that is blocked in restricted networks. Here the browser
 * only ever talks to the wiki's own origin (/api/transcribe, proxied to this
 * service by Firebase Hosting); the Google call happens server-side.
 *
 * Model Hierarchy:
 * - STT V2 Foundation Models: 'chirp_2' (Universal Speech Model, GA standard),
 *                             'chirp_3' (Next-Gen Multilingual Foundation)
 * - STT V1 Conformer:        'latest_long' (Legacy fallback)
 *
 * Configurable environment variables:
 * - STT_MODEL: Speech-to-Text model name (default: 'chirp_2')
 * - STT_API_VERSION: 'v2' or 'v1' (default: automatically determined by model name)
 * - STT_REGION: Cloud region for V2 recognizer (default: 'europe-west4' or 'us-central1')
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
const speech = require('@google-cloud/speech');

admin.initializeApp();

const PORT = process.env.PORT || 8080;
const DEFAULT_LANG = 'de-CH';
// A client that never sends the auth frame is dropped after this long.
const AUTH_TIMEOUT_MS = 5000;

// Model and API selection:
// Default to the flagship Chirp 2 foundation model on Speech-to-Text V2.
const STT_MODEL = process.env.STT_MODEL || 'chirp_2';
const STT_API_VERSION = process.env.STT_API_VERSION || (STT_MODEL.startsWith('chirp') ? 'v2' : 'v1');
const STT_REGION = process.env.STT_REGION || process.env.LOCATION || 'europe-west4';

// Project ID detected from environment or Firebase config
const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || 'insel-wiki';

// WebSocket close codes shared with the client (VoiceAssistant.js).
const CLOSE_AUTH = 4401; // bad/missing token — client must not retry
const CLOSE_LIMIT = 4011; // STT ~5-min limit — client reconnects transparently
const CLOSE_ERROR = 4500; // recognition failed — client reconnects, counts it

// Lazy initialization of speech clients
let _speechClientV1 = null;
let _speechClientV2 = null;

function getSpeechClientV1() {
  if (!_speechClientV1) {
    _speechClientV1 = new speech.SpeechClient();
  }
  return _speechClientV1;
}

function getSpeechClientV2() {
  if (!_speechClientV2) {
    _speechClientV2 = new speech.v2.SpeechClient({
      apiEndpoint: `${STT_REGION}-speech.googleapis.com`
    });
  }
  return _speechClientV2;
}

console.log(`[transcribe-service] Initialized with model: ${STT_MODEL} (API: ${STT_API_VERSION}, Region: ${STT_REGION})`);

const server = http.createServer((req, res) => {
  // Cloud Run startup/liveness probes and any non-WebSocket hit land here.
  res.writeHead(200, {
    'Content-Type': 'text/plain',
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0'
  });
  res.end(`transcribe-service [model: ${STT_MODEL}, api: ${STT_API_VERSION}]\n`);
});

const wss = new WebSocketServer({ server, maxPayload: 2 * 1024 * 1024 });

wss.on('connection', (ws) => {
  let recognizeStream = null;
  let authed = false;
  let stopped = false;
  const isV2 = STT_API_VERSION === 'v2';

  const send = (obj) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
  };

  const authTimer = setTimeout(() => {
    if (!authed) ws.close(CLOSE_AUTH, 'Auth timeout');
  }, AUTH_TIMEOUT_MS);

  const handleStreamData = (data) => {
    const result = data.results && data.results[0];
    const alt = result && result.alternatives && result.alternatives[0];
    if (!alt || !alt.transcript) return;
    
    const payload = { type: result.isFinal ? 'final' : 'interim', transcript: alt.transcript };
    if (alt.words && alt.words.length > 0) {
      payload.words = alt.words.map(w => {
        const start = w.startOffset || w.startTime;
        const end = w.endOffset || w.endTime;
        return {
          word: w.word,
          startTime: start ? (Number(start.seconds || 0) + (Number(start.nanos || 0) / 1e9)) : 0,
          endTime: end ? (Number(end.seconds || 0) + (Number(end.nanos || 0) / 1e9)) : 0,
        };
      });
    }
    send(payload);
  };

  const handleStreamError = (err) => {
    // code 11 (OUT_OF_RANGE) is the ~5-min single-stream limit.
    if (err.code === 11) {
      ws.close(CLOSE_LIMIT, 'Stream limit reached');
    } else {
      console.error(`streamingRecognize error [${STT_MODEL}]:`, err.code, err.message);
      send({ type: 'error', message: 'Transcription failed' });
      ws.close(CLOSE_ERROR, 'Recognition error');
    }
  };

  const handleStreamEnd = () => {
    // Reached after .end() has flushed the trailing finals post-stop.
    if (stopped && ws.readyState === ws.OPEN) ws.close(1000, 'Done');
  };

  const startRecognize = (languageCode) => {
    try {
      if (isV2) {
        const client = getSpeechClientV2();
        const recognizerPath = `projects/${PROJECT_ID}/locations/${STT_REGION}/recognizers/_`;
        
        recognizeStream = (typeof client._streamingRecognize === 'function' ? client._streamingRecognize() : client.streamingRecognize())
          .on('data', handleStreamData)
          .on('error', handleStreamError)
          .on('end', handleStreamEnd);

        recognizeStream.write({
          recognizer: recognizerPath,
          streamingConfig: {
            config: {
              model: STT_MODEL,
              languageCodes: [languageCode],
              explicitDecodingConfig: {
                encoding: 'WEBM_OPUS',
                sampleRateHertz: 48000,
                audioChannelCount: 1,
              },
              features: {
                enableAutomaticPunctuation: true,
                enableWordTimeOffsets: true,
              }
            },
            streamingFeatures: {
              interimResults: true,
            }
          }
        });
      } else {
        const client = getSpeechClientV1();
        recognizeStream = client
          .streamingRecognize({
            config: {
              encoding: 'WEBM_OPUS',
              sampleRateHertz: 48000,
              languageCode,
              enableAutomaticPunctuation: true,
              enableWordTimeOffsets: true,
              model: STT_MODEL || 'latest_long',
            },
            interimResults: true,
          })
          .on('data', handleStreamData)
          .on('error', handleStreamError)
          .on('end', handleStreamEnd);
      }
    } catch (err) {
      console.error('Failed to initialize recognizeStream:', err);
      ws.close(CLOSE_ERROR, 'Failed to initialize speech stream');
    }
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
        if (isV2) {
          recognizeStream.write({ audio: data });
        } else {
          recognizeStream.write(data);
        }
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
