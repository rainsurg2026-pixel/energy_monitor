# Google Sheets OAuth setup (desktop)

The desktop app's Google Sheets sync uses a real OAuth 2.0 Authorization
Code + PKCE flow, run entirely in the Electron main process
(`src/electron/googleAuth.ts`). To use it you need your own Google Cloud
OAuth client — the app ships with no credentials baked in, and none can be
committed to this repository.

## 1. Create a Desktop app OAuth client

1. In [Google Cloud Console](https://console.cloud.google.com/), create or
   select a project and enable the **Google Sheets API**.
2. Under **APIs & Services → Credentials**, create an **OAuth client ID**
   of type **Desktop app**.
3. Copy the generated Client ID and Client Secret.

## 2. Configure the app

1. Copy `google-oauth-desktop-config.example.json` (in the app root, next
   to the `.exe` for a packaged build) to `google-oauth-desktop-config.json`
   in the same folder.
2. Fill in your real `clientId`/`clientSecret`. This file is gitignored —
   never commit it.

## 3. Sign in

Launch the app, open **Settings**, enable Google Sheets sync, and click
**Sign in with Google**. Your system's default browser opens Google's
consent screen; after you approve, the app receives the authorization code
over a temporary local loopback listener (`127.0.0.1`, RFC 8252), exchanges
it for tokens, and reports "Connected". The access/refresh tokens are
encrypted at rest (Windows DPAPI via Electron's `safeStorage`) in the app's
`config/` folder and are never exposed to the renderer or written to logs.

If `google-oauth-desktop-config.json` is missing or contains the example
template's placeholder values, the app reports a clear "Connection Error"
naming the missing file instead of attempting to sign in — Excel/desktop
mode is entirely unaffected either way.
