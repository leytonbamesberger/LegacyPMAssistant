# Legacy PM Assistant

Internal web app for Legacy Mechanical — a hub for project-management tools.
This is a **proof of concept**: the shell (auth, navigation, tool grid) is in
place; no tool functionality yet.

## Stack

- Vite + React + TypeScript
- Tailwind CSS
- React Router v6
- Supabase (`@supabase/supabase-js`) — service-role writes via a serverless function
- MSAL (`@azure/msal-react`, `@azure/msal-browser`) for Microsoft / Azure AD login
- `jose` for server-side ID-token verification
- Deploy target: Vercel (`api/` serverless functions + static SPA)

## Getting started

```bash
npm install
cp .env.example .env.local   # then fill in the values
npm run dev
```

`npm run dev` runs the Vite dev server **and** the `/api/*` handlers (via a Vite
middleware), so local behaviour matches Vercel without needing the Vercel CLI.

### Environment variables

`VITE_*` vars are compiled into the browser bundle — **public**. Never put a
secret in one. The unprefixed vars are server-only (the `/api` handlers).

| Var | Scope | Purpose |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | client | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | client | Supabase anon key (public by design; can't touch `profiles`) |
| `VITE_AZURE_CLIENT_ID` | client | Azure AD app registration (SPA) client ID |
| `VITE_AZURE_TENANT_ID` | client | Legacy Mechanical's tenant ID — restricts sign-in to that tenant |
| `VITE_AZURE_REDIRECT_URI` | client | MSAL redirect URI; must match the app registration |
| `SUPABASE_SERVICE_ROLE_KEY` | **server, secret** | Bypasses RLS. Used by every `/api` handler. Starts with `eyJ`. |
| `SUPABASE_URL` | server | Optional — defaults to `VITE_SUPABASE_URL` |
| `AZURE_TENANT_ID` / `AZURE_CLIENT_ID` | server | Optional — default to the `VITE_` values |
| `APP_BASE_URL` | server | App origin, for building Procore redirect URLs (default `http://localhost:5173`) |
| `ANTHROPIC_API_KEY` | **server, secret** | Not used yet; reserved for the AI tools |
| `PROCORE_CLIENT_ID` | server | Procore Developer app — OAuth Credentials |
| `PROCORE_CLIENT_SECRET` | **server, secret** | Procore Developer app — OAuth Credentials |
| `PROCORE_OAUTH_STATE_SECRET` | **server, secret** | Random string you generate; signs the OAuth `state` |
| `PROCORE_REDIRECT_URI` | server | Optional — defaults to `APP_BASE_URL` + `/api/procore/callback` |
| `PROCORE_AUTH_BASE_URL` / `PROCORE_API_BASE_URL` | server | Optional — set to the Procore sandbox hosts to use the dev environment |

On Vercel, set these in **Project Settings → Environment Variables** (the
`VITE_` ones too). Procore stays "Unavailable" in the UI until
`PROCORE_CLIENT_ID`, `PROCORE_CLIENT_SECRET` and `PROCORE_OAUTH_STATE_SECRET`
are all set.

## Auth & profile flow

1. `/login` → "Sign in with Microsoft" → MSAL redirect against the single-tenant
   authority (`login.microsoftonline.com/<tenant-id>`).
2. On return, `ProtectedRoute` gates `/home`; unauthenticated users go to `/login`.
3. `Home` calls `ensureProfile()`, which acquires the MSAL **ID token** and
   `POST`s it to `/api/profile`.
4. [`server/profileHandler.ts`](server/profileHandler.ts) verifies the token
   (issuer = our tenant, audience = our client ID, signature via Microsoft's
   JWKS, not expired), then upserts the `profiles` row using the Supabase
   **service-role key**.

The browser never writes to Supabase directly.

## Database

SQL lives in [`supabase/schema.sql`](supabase/schema.sql). Apply it by hand in
the Supabase SQL editor — it is **not** run automatically.

- `profiles` — one row per user, keyed by Azure AD object ID (`azure_oid`).
  Provisioned by `/api/profile` on login.
- `procore_connections` — one row per profile (`unique (profile_id)`), holding
  the user's Procore OAuth tokens. Written only by `/api/procore/callback`.

**RLS:** both tables have Row Level Security **on with no policies**. The public
anon key can neither read nor write them; only the service-role key (server
side) can. This is the security boundary — see the comment block in
`schema.sql`.

**Migrations** (run once each, in order, against an existing project):
[`001_lock_down_profiles_rls.sql`](supabase/migrations/001_lock_down_profiles_rls.sql),
[`002_procore_connections_unique.sql`](supabase/migrations/002_procore_connections_unique.sql).

## Procore connection

1. Create an app at [developers.procore.com](https://developers.procore.com) →
   **OAuth Credentials**. Add redirect URIs for every origin you run on:
   `http://localhost:5173/api/procore/callback` and
   `https://<your-vercel-domain>/api/procore/callback`.
2. Put `PROCORE_CLIENT_ID`, `PROCORE_CLIENT_SECRET`, and a self-generated
   `PROCORE_OAUTH_STATE_SECRET` in `.env.local` (and Vercel).
3. In the app: profile menu → **Connect Procore**.

Flow: `POST /api/procore/authorize` (MSAL-authenticated) returns the Procore
consent URL carrying a signed `state` (CSRF + the profile id) → Procore redirects
to `GET /api/procore/callback` → the server exchanges the code for tokens and
upserts `procore_connections` → user returns to `/home?procore=connected`.
`server/procore.ts` `getValidAccessToken()` refreshes expired tokens (and
persists Procore's rotated refresh token) — that's the entry point for the
Procore-backed tools when they're built.

## Color usage

Custom Tailwind colors (see `tailwind.config.js`). Color is meaningful, not
decorative:

| Token | Hex | Use |
| --- | --- | --- |
| `legacy-blue-dark` | `#003058` | Primary nav / header, primary buttons |
| `legacy-blue-light` | `#18385f` | Secondary UI: borders, subtle backgrounds, inactive states |
| `legacy-red` | `#ee3428` | Accent only: active states, key CTAs, alerts. Used on the "Submittal Checker" card (next tool up). |

## Adding a real tool

1. Build the tool's page under `src/pages/` (or a `src/tools/<tool>/` folder).
2. In [`src/tools/registry.ts`](src/tools/registry.ts), set the tool's
   `status: 'active'` and give it a `path`.
3. Add the route in `src/App.tsx` behind `ProtectedRoute`.

The Home grid and `ToolCard` need no changes.

## Adding a server endpoint

Put shared logic in `server/` (framework-agnostic — takes inputs, returns
`{ status, body }`), then a thin `api/<name>.ts` Vercel adapter and a route in
the `vite.config.ts` dev middleware. This is the pattern Procore token exchange
and any AI API calls should follow — those keys must stay server-side.

## Project layout

```
api/                   thin Vercel adapters (one file = one endpoint)
  profile.ts
  procore/
    authorize.ts  callback.ts  status.ts  disconnect.ts
server/                framework-agnostic handlers + logic
  http.ts              ApiResult shape + helpers
  config.ts            server-only env (throws if a required var is missing)
  vercelAdapter.ts     wrap a handler as a Vercel function
  auth.ts              verify Microsoft ID token, get Supabase admin, upsert profile
  profileHandler.ts    POST /api/profile
  procore.ts           Procore OAuth: state signing, token exchange/refresh, storage
  procoreRoutes.ts     the four /api/procore/* handlers
src/
  components/
    icons.tsx               placeholder tool icons
    ProfileMenu.tsx         header avatar + dropdown
    ProcoreConnectionItem.tsx  connect / disconnect / unavailable row
    ProtectedRoute.tsx      auth gate, redirects to /login
    ToolCard.tsx            single tool grid entry
  lib/
    msalConfig.ts      MSAL config (single-tenant authority) + login scopes
    apiClient.ts       getIdToken() + apiFetch(): call /api with the ID token
    profiles.ts        ensureProfile()
    procore.ts         getProcoreStatus / startProcoreConnect / disconnectProcore
    supabaseClient.ts  browser anon client — reserved for future public reads
  pages/
    Home.tsx           protected; header, tool grid, Procore result banner
    Login.tsx          Microsoft sign-in
  tools/
    registry.ts        the tool list rendered by Home
  App.tsx              routes
  main.tsx             MSAL bootstrap + providers
supabase/
  schema.sql           tables + RLS
  migrations/          one-off SQL to run against an existing project
vercel.json            SPA rewrite (everything except /api/* -> index.html)
```

## Deploying to Vercel

- `vercel.json` handles the SPA history-mode rewrite; `api/` is auto-detected.
- Set all env vars (including `VITE_*` and `SUPABASE_SERVICE_ROLE_KEY`) in the
  Vercel project.
- Register the deployed origin as a **Single-page application** redirect URI in
  the Azure app registration (and set `VITE_AZURE_REDIRECT_URI` to match).
