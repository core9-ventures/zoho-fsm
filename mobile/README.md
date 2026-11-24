# FieldServe mobile app (Android)

Capacitor + React (Vite, Tailwind). It talks to the same FieldServe server and database as the web portal.
Stage 1 is online only; offline comes in Stage 2.

## Run the app in the browser (live preview)

```bash
pnpm install
pnpm dev            # http://localhost:5173  (set the phone size in the browser's device toolbar)
```

The server it talks to is `VITE_API_BASE_URL` (see `.env.example`); the default is `http://localhost:3100`,
so start the web app (`pnpm dev` in the project root) first.

## Build the APK (Windows, needs Android Studio)

```bash
pnpm apk            # builds the web app, syncs Capacitor, runs Gradle, writes apk/fieldserve-debug.apk
```

Set `VITE_API_BASE_URL` to the live server before building an APK for the team.

## Where things are

- `src/api/` — the one data layer every screen uses (HTTP client with token refresh, auth, installations).
  The input and output types come from the server's own zod schemas in `../src/modules/*`.
- `src/session.tsx` — sign-in state. `src/pages/` — screens. `src/components/` — layouts.
- The server must allow the app's origin (CORS): `https://localhost` is allowed by default; add more with the
  server's `CORS_ALLOWED_ORIGINS` (comma-separated).
