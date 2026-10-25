# Boulder Load Manager

A local-first web app that tracks bouldering and strength training load, and helps you avoid the sudden jumps that lead
to overuse injuries. It compares your recent load with what you are used to (ACWR) and suggests sessions that keep the
two in balance.

Live: https://boulder-load-manager.vercel.app

## Features

- **Bouldering ACWR** from your sessions: EWMA acute/chronic ratio over all your climbing, updated daily (rest days count).
- **Load relative to your current max**: each problem is scored against the hardest grade you've climbed on 2+ days in
  the past year, so load stays meaningful as you get stronger.
- **What to climb next**: three session options (volume, medium, high intensity) as grades × attempts that keep you in
  the green zone. High intensity is never suggested while you are over or close to the high threshold.
- **Trends & readiness**: week-over-week change, monotony, strain, and weekly sleep/stress charts. Sleep, stress and
  motivation give a readiness verdict instead of changing load.
- **TopLogger sync**: climbing days logged in TopLogger become sessions automatically.
- **Strength ACWR** from FitNotes CSV exports (upload, or the latest export in your Google Drive).
- **Google Drive backup**, JSON export/import, light/dark theme, and an in-app Guide that explains every number.

Everything is stored in the browser (IndexedDB). Nothing leaves the device except calls to TopLogger (when connected)
and Google Drive (when signed in).

## Run locally

```bash
npm install
npm run dev
```

`npm run build` type-checks and builds to `dist/`; `npm run lint` runs ESLint.

To use Google sign-in locally, copy `.env.example` to `.env.local` and set `VITE_GOOGLE_CLIENT_ID`.

## Deploy (Vercel)

1. Import the repository in Vercel (framework preset: Vite, output directory `dist`).
2. Set the environment variable `VITE_GOOGLE_CLIENT_ID` for Production and Preview.
3. Pushing to `main` deploys to production.

`api/toplogger.ts` is deployed as a Vercel function (see TopLogger below).

## Google sign-in and Drive

Sign-in uses Google's browser token flow; no client secret or server is needed.

In Google Cloud Console:

1. **Credentials → OAuth client ID** (Web application). Add your deployed origin and `http://localhost:5173` both as
   *Authorized JavaScript origins* and as *Authorized redirect URIs*.
2. **OAuth consent screen → Data access**: add the scopes `drive.file` (backups the app creates) and `drive.readonly`
   (to find FitNotes exports other apps created). `drive.readonly` is a restricted scope, so keep the app in
   **Testing** mode and add your users as test users.

## TopLogger

TopLogger has no public API or OAuth, and its sign-in requires reCAPTCHA, so the app connects with a refresh token from a
signed-in TopLogger web session (the Bouldering tab shows a console snippet that copies it). The token is kept only in
the browser's localStorage and rotates on every refresh.

- Requests go through `api/toplogger.ts`, a thin proxy, because TopLogger only allows CORS from its own site.
  `npm run dev` uses an equivalent proxy configured in `vite.config.ts`.
- One session per climb day. Grades use TopLogger's own V-scale table; wall angle is guessed from the wall name.
- Sessions edited or deleted in the app are left alone by later syncs.
- This relies on TopLogger's private web-app API and can break if TopLogger changes it.

## Code layout

- `src/App.tsx`: app shell, tabs, state and persistence flows.
- `src/domain/`
  - `acwr.ts`: daily EWMA/ACWR history, prediction, load solver, trend metrics.
  - `loadCalculator.ts`: grade intensity, current max grade, session load, readiness.
  - `recommendations.ts`: "What to climb next" options.
  - `strengthLoad.ts`: strength set loads and ACWR per exercise/category.
  - `wellness.ts`: weekly sleep and stress averages.
  - `loadModelConfig.ts`: default settings and validation/migration.
- `src/components/`: tabs, cards, the session form and the chart library (`charts/`).
- `src/integrations/`: TopLogger client, FitNotes CSV parser, Google Drive.
- `src/db/indexedDb.ts`: local storage.
- `api/toplogger.ts`: Vercel proxy to TopLogger's GraphQL API.
