# transcribe-service

Streaming speech-to-text proxy for the wiki's voice input. A WebSocket server
(Cloud Run) that pipes browser mic audio into Google Cloud Speech-to-Text's
`streamingRecognize` and streams transcripts back. See `server.js` for the
protocol.

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
  --timeout 3600

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
