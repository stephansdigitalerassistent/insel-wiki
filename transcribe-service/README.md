# transcribe-service

Streaming speech-to-text proxy for the wiki's voice input. A WebSocket server
(Cloud Run) that pipes browser mic audio into Google Cloud Speech-to-Text
and streams transcripts back. See `server.js` for protocol details.

## Models & Engine Upgrades

This service supports Google's newest Speech-to-Text foundation models:
* **Chirp 2 (`chirp_2`)** (Default): Google's 2B-parameter Universal Speech Model (USM) foundation model on Speech-to-Text V2. Features state-of-the-art multilingual accuracy, low word error rate (WER) across 100+ languages including Swiss German / German (`de-CH`), automatic punctuation, and word-level timestamps.
* **Chirp 3 (`chirp_3`)**: Next-generation multilingual speech foundation model available via Speech-to-Text V2.
* **Legacy Conformer (`latest_long`)**: Conformer-based model on Speech-to-Text V1 (available for fallback).

### Environment Configuration
* `STT_MODEL`: Model name (default: `chirp_2`; can be set to `chirp_3` or `latest_long`).
* `STT_API_VERSION`: `v2` (for Chirp models) or `v1` (auto-detected from model name).
* `STT_REGION`: Region for V2 recognizers (default: `europe-west4`).

## Deploy

```bash
# 1. Enable the API (billing already on)
gcloud services enable speech.googleapis.com --project insel-wiki
gcloud services enable speech.googleapis.com --project insel-wiki-beta

# 2. Deploy the Cloud Run service (run once per project)
gcloud run deploy transcribe \
  --source . \
  --project insel-wiki-beta \
  --region europe-west1 \
  --allow-unauthenticated \
  --timeout 3600 \
  --set-env-vars STT_MODEL=chirp_2,STT_REGION=europe-west4

# then the same with --project insel-wiki for production
```

`--allow-unauthenticated` exposes the service to Firebase Hosting's proxy;
the service still requires a valid Firebase ID token in the WebSocket auth
frame, so it is not open. `--timeout 3600` lets a dictation WebSocket stay
open (Cloud Run's default is 300s).

The `/api/transcribe` Hosting rewrite (`firebase.json`) points at this
service, so `npm run deploy` / `deploy:beta` ship the matching frontend.

If transcription fails with a permissions error in the logs, grant the
service's runtime service account `roles/speech.client`.
