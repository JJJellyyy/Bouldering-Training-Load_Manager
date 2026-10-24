# Boulder Load Manager

Local-first web app for tracking bouldering load with configurable EWMA calculations.

## What Is Implemented

- Session logging flow: problems count, grade (V4-V13), hold type, wall angle.
- Session context: duration, sleep before session, stress, motivation.
- Configurable load model values in settings:
  - Grade intensity curve.
  - Speed multiplier curve.
  - Sleep penalty curve.
- EWMA output per hold x angle combination for windows 10, 15, 20, 25.
- Local persistence with IndexedDB (sessions, settings, EWMA snapshots, strength sets).
- TopLogger sync: climbing days logged in TopLogger become bouldering sessions automatically.
- Strength ACWR from FitNotes CSV exports (upload, or sync the latest export from Google Drive).

## TopLogger Sync

TopLogger has no public API or OAuth, and its sign-in requires reCAPTCHA, so the app connects with a refresh token
taken from a signed-in TopLogger web session (Session tab → TopLogger Sync shows a console snippet that copies it).
The token is kept in this browser's localStorage only and rotates on every refresh.

- Requests go through `api/toplogger.ts` (a thin proxy, because TopLogger only allows CORS from app.toplogger.nu).
  `npm run dev` uses an equivalent Vite proxy in `vite.config.ts`.
- One session per TopLogger climb day. Grades map with TopLogger's own V-scale table, wall angle is guessed from the
  wall name, hold type is `mixed`; duration uses the configured default and sleep the personal max.
- Sessions you edit after syncing are marked and never overwritten by later syncs.
- This uses TopLogger's private web-app API, so it can break if TopLogger changes it.

## Strength (FitNotes)

Export from FitNotes as CSV (`FitNotes_Export_*.csv`), then upload it on the Strength tab, or save it to Google Drive
and use "Sync latest export from Google Drive" (optionally on every app start). Each import replaces all strength data.

Per-set load metrics: relative intensity (reps × weight / best e1RM so far, the default), volume (kg × reps) or sets.
Bodyweight is added for exercises marked "+BW". ACWR uses its own acute/chronic EWMA windows (default 7/28 days).

Drive sync needs the `drive.readonly` scope (to see files FitNotes created). After this update, sign out and sign in
with Google again so the new scope is granted, and add the scope to the OAuth consent screen in Google Cloud.

## Run Locally

```bash
npm install
npm run dev
```

Open the local URL shown in the terminal.

## Build

```bash
npm run build
npm run preview
```

## Deployment Recommendation

Deploy on Vercel first.

Why this is a good fit:
- Static React/Vite frontend deploys fast.
- Easy preview URLs per commit.
- Simple environment variable management when Google Drive sync is added.

### Vercel Steps

1. Push this project to GitHub.
2. Import the repository in Vercel.
3. Framework preset: Vite.
4. Build command: `npm run build`.
5. Output directory: `dist`.
6. Deploy.

### Vercel CLI (optional)

1. Install CLI globally: `npm i -g vercel`
2. Login: `vercel login`
3. Run first deploy: `vercel`
4. Run production deploy: `npm run deploy:vercel`

### Post Deploy Checks

1. Open the deployed URL.
2. Create a test session and refresh the page.
3. Confirm the session is still present (IndexedDB persistence).
4. Open Vercel project settings and set your production domain.

When Google Drive sync is added, register production and preview OAuth redirect URLs in Google Cloud.

## Google Drive OAuth Setup (Vercel + Google Cloud)

This app now includes Google Drive backup/restore in the Settings tab.

### 1) Create OAuth Client In Google Cloud

1. Open Google Cloud Console.
2. APIs & Services -> Credentials -> Create Credentials -> OAuth client ID.
3. Application type: Web application.
4. Add Authorized JavaScript origins:
  - https://boulder-load-manager.vercel.app
  - Your branch preview URL origin from Vercel (for example your stable main-branch preview domain)
  - http://localhost:5173
5. Add Authorized redirect URI entries:
  - https://boulder-load-manager.vercel.app
  - Your preview deployment URL
  - http://localhost:5173

Note: Vercel generates many preview URLs. Keep one stable preview URL for OAuth testing, or test Drive sync on production only.

### 2) Add Client ID To Vercel

1. Vercel Project -> Settings -> Environment Variables.
2. Add variable: `VITE_GOOGLE_CLIENT_ID`.
3. Value: your OAuth Client ID from Google Cloud.
4. Set for Production and Preview.
5. Redeploy.

### 3) Add Client ID Locally

1. Create `.env.local` from `.env.example`.
2. Set `VITE_GOOGLE_CLIENT_ID=...`.
3. Run `npm run dev`.

### 4) Test Flow

1. Open Settings -> Google Drive Sync.
2. Click Connect Google Drive.
3. Click Upload Backup.
4. Click Restore Backup.

## Core Files

- `src/App.tsx` - Main UI and save flow.
- `src/domain/loadCalculator.ts` - Grade intensity, speed multiplier, sleep penalty, session load.
- `src/domain/ewma.ts` - EWMA updates.
- `src/domain/loadModelConfig.ts` - Default and clamped model configuration.
- `src/db/indexedDb.ts` - Local database access.
- `src/types/index.ts` - Domain models and config types.
- `src/domain/strengthLoad.ts` - Strength set loads, daily EWMA and ACWR per exercise/category.
- `src/integrations/toplogger.ts` - TopLogger GraphQL client and session mapping.
- `src/integrations/fitnotes.ts` - FitNotes CSV parser.
- `api/toplogger.ts` - Vercel proxy to TopLogger's GraphQL API.
