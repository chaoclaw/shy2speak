# Shy2Speak

Responsive, dependency-free PWA for practising spoken English with real video content. It supports desktop and mobile layouts, a YouTube-backed course catalog, sentence practice, browser recording, persistent local learning analytics, vocabulary review, immersive listening, offline app data, AI provider configuration and audio-to-slide generation.

## Run locally

```bash
python3 -m http.server 4173
```

Open `http://localhost:4173`.

No dependency installation or build step is required.

## Data and service boundaries

- `data/catalog.json` contains the versioned course contract and the initial YouTube playlist/video IDs.
- Video playback uses the official `youtube-nocookie.com` embed. Runtime title/channel metadata is read from YouTube oEmbed when the user loads a video.
- Practice time, attempts, recordings, prompt templates, settings and custom video topics persist in browser storage.
- Microphone recording uses the browser `MediaRecorder` API and reports the real device, duration and byte size. A configured speech endpoint receives a real multipart POST and must return `total`, `pronunciation`, `fluency` and `completeness` before the score is stored.
- AI tests issue real requests to the configured endpoint. API keys only live in `sessionStorage`; a production deployment should proxy secrets through a backend.
- YouTube captions/chapters, email/phone authentication, globally unique nicknames and vendor pronunciation scores still require authorized backend services. The UI labels these states instead of reporting mock success.
- Copyright-protected YouTube media is not downloaded or redistributed. Offline caching is limited to the PWA shell, structured learning data and authorized/user-owned media.

## Test

```bash
node --check app.js
node tests/data-contract.cjs
node tests/ui-smoke.cjs
```

The browser smoke test launches the installed system Chromium and verifies all eight views, responsive Practice layouts, the YouTube adapter, auth-method separation, AI configuration state and mobile touch targets. See `docs/acceptance-cases.md` for the complete acceptance matrix and device/manual cases.
