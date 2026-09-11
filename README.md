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
- `projects` — cached mirror of Procore projects, shared across all users (not
  per-profile). Refreshed by `/api/projects/sync` using each caller's own
  Procore token. Rows not seen in the latest sync are soft-deleted
  (`is_active = false`), never hard-deleted.
- `user_starred_projects` — join table: which projects a profile has starred.

**RLS:** every table has Row Level Security **on with no policies**. The public
anon key can neither read nor write any of them; only the service-role key
(server side) can. This is the security boundary — see the comment block in
`schema.sql`. (There is no Supabase-Auth `authenticated` role in this app —
auth is MSAL — so "authenticated users can read" is implemented as "verified-
Microsoft-token requests through our own `/api` routes," not as an RLS policy.)

**Migrations** (run once each, in order, against an existing project):
[`001_lock_down_profiles_rls.sql`](supabase/migrations/001_lock_down_profiles_rls.sql),
[`002_procore_connections_unique.sql`](supabase/migrations/002_procore_connections_unique.sql),
[`003_projects_and_starred.sql`](supabase/migrations/003_projects_and_starred.sql).

## Procore connection

1. Create an app at [developers.procore.com](https://developers.procore.com) →
   **OAuth Credentials**. Add a redirect URI for **every** origin you run on —
   Procore requires an exact match:
   - `http://localhost:5173/api/procore/callback`
   - `https://<your-vercel-domain>/api/procore/callback`
2. Put `PROCORE_CLIENT_ID`, `PROCORE_CLIENT_SECRET`, and a self-generated
   `PROCORE_OAUTH_STATE_SECRET` in `.env.local` and in the Vercel project.
3. Set `APP_BASE_URL` in Vercel to your production URL (see below).
4. In the app: profile menu → **Connect Procore**.

### The redirect URI

`server/config.ts` builds the OAuth `redirect_uri` (used identically in the
authorize step and the token exchange) as `<base>/api/procore/callback`, where
`<base>` is, in order: `APP_BASE_URL`, else the origin of the incoming request
(`x-forwarded-proto`/`host`), else `http://localhost:5173`.

So on Vercel a plain production deploy works even without `APP_BASE_URL` — but
set it anyway (to the stable production URL) so **preview** deployments send a
`redirect_uri` Procore recognises instead of the throwaway preview hostname.
`APP_BASE_URL` is not a secret; a normal Vercel env var is fine.

Flow: `POST /api/procore/authorize` (MSAL-authenticated) returns the Procore
consent URL carrying a signed `state` (CSRF + the profile id) → Procore redirects
to `GET /api/procore/callback` → the server exchanges the code for tokens and
upserts `procore_connections` → user returns to `/home?procore=connected`.
`server/procore.ts` `getValidAccessToken()` refreshes expired tokens (and
persists Procore's rotated refresh token) — that's the entry point for the
Procore-backed tools when they're built.

## Project selector (sidebar)

Every protected page is wrapped (by `ProtectedRoute`) in `UnsavedWorkProvider` →
`ProjectProvider` → `AppShell`, so the header + left sidebar and the project
context are available everywhere without each page wiring them up.

- **`ProjectContext`** (`src/contexts/ProjectContext.tsx`) holds the project
  list, the selected project (persisted in `localStorage`), and sync state.
  On mount it loads the cached list from `GET /api/projects` immediately, then
  fires `POST /api/projects/sync` in the background — the UI never blocks on
  Procore. `refreshProjects()` is the same call, exposed for the sidebar's
  manual refresh button.
- **`server/projects.ts`** does the actual sync: list the caller's Procore
  companies, list each company's projects (their own OAuth token, refreshed
  via `getValidAccessToken()` if needed), upsert into `projects`, then
  soft-delete anything not seen. A user with no Procore connection, or a dead
  refresh token, gets `syncOk: false` + a message — never a crash — and the
  UI keeps showing cached data with a small red dot on the refresh icon.
- Procore's exact field names for a project's "active" status aren't fully
  pinned down from public docs — `pickJobNumber`/`pickActive`/`pickName` in
  `server/projects.ts` read several plausible field names defensively. If a
  synced project shows a blank job number, check a raw Procore project object
  in the logs and adjust the candidate list there.
- **`UnsavedWorkContext`** (`src/contexts/UnsavedWorkContext.tsx`) is a bare
  `hasUnsavedWork`/`setUnsavedWork(flag, description?)` store. Nothing sets it
  yet — a tool calls `setUnsavedWork(true, 'submittal check in progress')`
  while the user has in-progress work, and `false` when it's safe to leave.
  `ProjectContext.selectProject()` checks this before switching and, if set,
  shows `UnsavedWorkGuardModal` instead of switching immediately.

## Adding a server endpoint

Put shared logic in `server/` (framework-agnostic — takes inputs, returns an
`ApiResult`), then a thin `api/<name>.ts` Vercel adapter and a route in the
`vite.config.ts` dev middleware. This is the pattern Procore token exchange,
the project sync, and any future AI API calls should follow — those keys must
stay server-side.

**Two hard-won rules for anything in `server/` or `api/`** (see the comment at
the top of `server/vercelAdapter.ts` for the full story): every relative
import needs an explicit `.js` extension (`from './config.js'`, not
`'./config'`) — Node's native ESM loader requires it and `tsconfig.node.json`
is set to `NodeNext` specifically so a missing one is a compile error, not a
production crash. And never use `import type { X }` or inline `{ type X }` —
plain `import { X } from 'y'` only; Vercel's dependency scanner fails to parse
the type-only form and can silently leave real dependencies out of the deploy.

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

## Project layout

```
api/                   thin Vercel adapters (one file = one endpoint)
  profile.ts
  procore/
    authorize.ts  callback.ts  status.ts  disconnect.ts
  projects/
    index.ts (GET /api/projects)  sync.ts  star.ts
server/                framework-agnostic handlers + logic
  http.ts              ApiResult shape + helpers
  config.ts            server-only env (throws if a required var is missing)
  vercelAdapter.ts     wrap a handler as a Vercel function (see its header
                       comment for the two NodeNext/import-type rules)
  auth.ts              verify Microsoft ID token, get Supabase admin, upsert
                       profile, resolveProfile() (the common first step)
  profileHandler.ts    POST /api/profile
  procore.ts           Procore OAuth: state signing, token exchange/refresh, storage
  procoreRoutes.ts     the four /api/procore/* handlers
  procoreApi.ts        generic Procore REST GET (companies, projects-by-company)
  projects.ts          sync/list/star logic for the project cache
  projectRoutes.ts     the three /api/projects* handlers
src/
  components/
    icons.tsx               placeholder tool icons + sidebar icons
    AppShell.tsx            header + sidebar chrome, wraps every protected page
    Sidebar.tsx             collapsible project selector (search, star, refresh)
    UnsavedWorkGuardModal.tsx  confirm-before-switch dialog
    ProfileMenu.tsx         header avatar + dropdown
    ProcoreConnectionItem.tsx  connect / disconnect / unavailable row
    ProtectedRoute.tsx      auth gate; wraps children in the context providers + AppShell
    ToolCard.tsx            single tool grid entry
  contexts/
    ProjectContext.tsx      selected project (persisted), project list, sync state
    UnsavedWorkContext.tsx  hasUnsavedWork/setUnsavedWork — no tool uses it yet
  lib/
    msalConfig.ts      MSAL config (single-tenant authority) + login scopes
    apiClient.ts       getIdToken() + apiFetch(): call /api with the ID token
    profiles.ts        ensureProfile()
    procore.ts         getProcoreStatus / startProcoreConnect / disconnectProcore
    projects.ts        fetchProjects / syncProjects / setProjectStarred
    supabaseClient.ts  browser anon client — reserved for future public reads
  pages/
    Home.tsx           protected; tool grid, Procore result banner (no header — AppShell owns that)
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
