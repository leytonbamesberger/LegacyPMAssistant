# Legacy PM Assistant

Internal web app for Legacy Mechanical — a hub for project-management tools.
This is a **proof of concept**: the shell (auth, navigation, tool grid) is in
place; no tool functionality yet.

## Stack

- Vite + React + TypeScript
- Tailwind CSS
- React Router v6
- Supabase JS client (`@supabase/supabase-js`)
- MSAL (`@azure/msal-react`, `@azure/msal-browser`) for Microsoft / Azure AD login
- Deploy target: Vercel

## Getting started

```bash
npm install
cp .env.example .env.local   # then fill in the values
npm run dev
```

### Environment variables

| Var | Purpose |
| --- | --- |
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon key |
| `VITE_AZURE_CLIENT_ID` | Azure AD app registration (SPA) client ID |
| `VITE_AZURE_TENANT_ID` | Legacy Mechanical's Azure AD tenant ID — restricts sign-in to that tenant |
| `VITE_AZURE_REDIRECT_URI` | MSAL redirect URI; must match the app registration (defaults to `window.location.origin`) |

## Database

SQL lives in [`supabase/schema.sql`](supabase/schema.sql). Apply it by hand in
the Supabase SQL editor — it is **not** run automatically. Tables:

- `profiles` — one row per user, keyed by Azure AD object ID (`azure_oid`).
  Created on first login by [`src/lib/profiles.ts`](src/lib/profiles.ts).
- `procore_connections` — placeholder for per-user Procore OAuth tokens. Table
  only; no flow wired up. The "Connect Procore" item in the profile menu is a
  disabled placeholder.

## Auth flow

1. `/login` → "Sign in with Microsoft" → MSAL redirect against the single-tenant
   authority (`login.microsoftonline.com/<tenant-id>`).
2. On return, `ProtectedRoute` gates `/home`; unauthenticated users go to `/login`.
3. `Home` calls `ensureProfile()` — looks up the `profiles` row by `azure_oid`,
   creates it if missing.

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
src/
  components/
    icons.tsx          placeholder tool icons
    ProfileMenu.tsx    header avatar + dropdown (Sign out, Connect Procore)
    ProtectedRoute.tsx auth gate, redirects to /login
    ToolCard.tsx       single tool grid entry
  lib/
    msalConfig.ts      MSAL config (single-tenant authority) + login scopes
    profiles.ts        ensureProfile(): Supabase profiles upsert on login
    supabaseClient.ts  Supabase client
  pages/
    Home.tsx           protected; header + tool grid
    Login.tsx          Microsoft sign-in
  tools/
    registry.ts        the tool list rendered by Home
  App.tsx              routes
  main.tsx             MSAL bootstrap + providers
```

## Deploying to Vercel

No Vercel config is committed yet. When you add it, remember the SPA needs a
catch-all rewrite to `index.html` (React Router uses history-mode routing), and
the `VITE_*` env vars must be set in the Vercel project. The MSAL redirect URI
must also be registered for the deployed origin.
