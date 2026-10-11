# Shy2Speak

Responsive, dependency-free PWA for practising spoken English with real video content. It supports desktop and mobile layouts, a YouTube-backed course catalog, sentence practice, browser recording, local-first learning analytics, optional Supabase account sync, vocabulary review, immersive listening, offline app data, AI provider configuration and audio-to-slide generation.

## Run locally

```bash
python3 -m http.server 4173
```

Open `http://localhost:4173`.

No dependency installation or build step is required.

## Account backend

The app uses a Supabase-compatible public browser API for real email/phone authentication, password recovery, globally unique nicknames and cross-device learning sync. Offline learning remains available when no backend is configured.

1. Create or select an existing Supabase project.
2. Run [`supabase/schema.sql`](supabase/schema.sql) once in its SQL editor.
3. Enable the desired email and phone providers. Phone OTP requires an SMS provider configured in Supabase.
4. In GitHub repository variables, set `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`. The Pages workflow writes them to `runtime-config.js` at deploy time.

Alternatively, enter the same Project URL and publishable key from Settings → Account & Sync. Device configuration stays in local storage. A publishable/anon key is expected in the browser; never use a `service_role` key.

## Data and service boundaries

- `data/catalog.json` contains the versioned course contract and the initial YouTube playlist/video IDs.
- Video playback uses the official `youtube-nocookie.com` embed. Runtime title/channel metadata is read from YouTube oEmbed when the user loads a video.
- Practice time, attempts, recordings, prompt templates, settings and custom video topics persist in browser storage and sync after account login.
- Microphone recording uses the browser `MediaRecorder` API and reports the real device, duration and byte size. A configured speech endpoint receives a real multipart POST and must return `total`, `pronunciation`, `fluency` and `completeness` before the score is stored.
- AI tests issue real requests to the configured endpoint. API keys only live in `sessionStorage`; a production deployment should proxy secrets through a backend.
- Email/phone authentication, password recovery, globally unique nicknames and learning snapshots use the Supabase adapter when configured. The UI keeps an honest offline state when it is not configured.
- YouTube captions/chapters and vendor pronunciation scores still require their respective authorized services. The UI labels these states instead of reporting mock success.
- Copyright-protected YouTube media is not downloaded or redistributed. Offline caching is limited to the PWA shell, structured learning data and authorized/user-owned media.

## Test

```bash
node --check app.js
node --check backend.js
node tests/data-contract.cjs
node tests/backend-contract.cjs
node tests/ui-smoke.cjs
```

The browser smoke test launches the installed system Chromium and verifies all eight views, responsive Practice layouts, the YouTube adapter, Supabase health/auth/sync flow, auth-method separation, AI configuration state and mobile touch targets. See `docs/acceptance-cases.md` for the complete acceptance matrix and device/manual cases.
