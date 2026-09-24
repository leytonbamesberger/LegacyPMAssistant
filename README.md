# Legacy PM Assistant

Internal web app for Legacy Mechanical — a hub for project-management tools.
Proof of concept: the shell (auth, navigation, project selector) is in place,
and the first real tool — **Submittal Checker** — is wired end to end.

## Stack

- Vite + React + TypeScript
- Tailwind CSS
- React Router v6
- Supabase (`@supabase/supabase-js`) — service-role writes via a serverless function
- MSAL (`@azure/msal-react`, `@azure/msal-browser`) for Microsoft / Azure AD login
- `jose` for server-side ID-token verification
- Anthropic Claude (raw `fetch`, no SDK) for the Submittal Checker's AI pipeline
- `unpdf` for serverless-friendly PDF text extraction; `fuse.js` for client-side fuzzy search
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
| `ANTHROPIC_API_KEY` | **server, secret** | Used by the Submittal Checker's AI pipeline (`server/ai/anthropicClient.ts`) |
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
  per-profile). Refreshed by `POST /api/projects` using each caller's own
  Procore token. Rows not seen in the latest sync are soft-deleted
  (`is_active = false`), never hard-deleted.
- `user_starred_projects` — join table: which projects a profile has starred.
- `spec_sections` — raw spec text cached per project + normalized CSI section
  (see `shared/csi.ts`). `procore_version` is actually a content hash, not a
  Procore-supplied field — see the Submittal Checker section below.
- `spec_checklists` — the AI-extracted requirement checklist per project +
  section, invalidated when `source_spec_version` no longer matches the
  section's current hash.
- `app_config` — key/value settings readable at request time, e.g.
  `confidence_threshold` (default `80`) — edit directly in the SQL editor,
  no redeploy needed.
- `submittal_checks` / `ai_usage_logs` — one row per uploaded submittal and
  its result, and one row per AI call made while producing it (for cost
  tracking). See the Submittal Checker section below.
- Storage bucket `submittals` (private) — uploaded submittal PDFs, one per
  `submittal_checks` row (`{project_id}/{submittal_check_id}.pdf`).

**RLS:** every table has Row Level Security **on with no policies**. The public
anon key can neither read nor write any of them; only the service-role key
(server side) can. This is the security boundary — see the comment block in
`schema.sql`. (There is no Supabase-Auth `authenticated` role in this app —
auth is MSAL — so "authenticated users can read" is implemented as "verified-
Microsoft-token requests through our own `/api` routes," not as an RLS policy.)

**Migrations** (run once each, in order, against an existing project):
[`001_lock_down_profiles_rls.sql`](supabase/migrations/001_lock_down_profiles_rls.sql),
[`002_procore_connections_unique.sql`](supabase/migrations/002_procore_connections_unique.sql),
[`003_projects_and_starred.sql`](supabase/migrations/003_projects_and_starred.sql),
[`004_submittal_checker.sql`](supabase/migrations/004_submittal_checker.sql).

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
  fires `POST /api/projects` (same path, different verb — see the Hobby-plan
  function-count note below) in the background — the UI never blocks on
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

## Submittal Checker

The first real tool: upload a submittal PDF, get it checked against the
project's cached specs across 6 weighted categories, with a scored result.

**Pipeline** (`server/submittals.ts` `runSubmittalCheck`), all AI calls via
`server/ai/anthropicClient.ts`'s `callAnthropicTool()` — forced tool-use so
every response is schema-guaranteed JSON, never parsed from free text, and
**never auto-retried**: a failure marks the row `failed` and the UI offers a
manual Retry, so a bad response can't silently loop and burn tokens.

1. **Section identification** (skipped if the user picked a section manually)
   — Haiku classifies the PDF, flags true multi-product bundles, and returns a
   confidence score. Below `app_config.confidence_threshold` (or Haiku returns
   no clear section), the pipeline stops without failing and the UI shows the
   CSI picker instead. A detected multi-product bundle (and the user hasn't
   checked "treat as one submittal") stops the check with `status: 'multi_product'`.
   The resolved section is persisted immediately, before the next two
   (separately billed) steps run — so a later failure's retry doesn't re-run
   identification.
2. **Checklist lookup/extraction** (`server/specs.ts` `getOrExtractChecklist`)
   — reuses the cached `spec_checklists` row if its `source_spec_version`
   still matches the section's current hash, otherwise re-extracts with Haiku.
3. **Compliance check** — Sonnet 5 at `medium` effort scores the submittal PDF
   against the checklist across the 6 categories.
4. **Scoring**: Pass=2/Caution=1/Fail=0 × category weight (Manufacturer/Model 5,
   Sizing 5, Certifications 4, Performance Data 4, Accessories 3, Misc 1),
   summed and divided by `2 × Σweight` over non-N/A categories only. All-N/A
   → `score_percent: null`, shown as an explanatory state instead of a bar.

**Model/prompt config** — `server/ai/modelConfig.ts` (`PROMPT_MODEL_CONFIG`) is
the single place each step's provider/model/effort is chosen; add a provider
later by adding a `callXyz()` next to `callAnthropicTool` and branching there —
no pipeline call site changes. The three prompts you supplied are stored
verbatim in `server/prompts/{specIdentification,specExtraction,complianceCheck}.ts`.

**Deviation from the brief:** these live under `server/ai/` and `server/prompts/`,
not `src/lib/ai/`/`src/lib/prompts/` as sketched. Nothing in this pipeline ever
runs in the browser — keeping it entirely inside the server-only tree means it
can't accidentally end up in the client bundle, and avoids crossing the
`bundler` (client) / `NodeNext` (server) tsconfig boundary described above for
no benefit.

**Spec sync** (`server/specs.ts` `syncProjectSpecs`, via "Sync Specs") lists the
project's `specification_sections` with the caller's own Procore token — each
entry only carries metadata (`id`, `number`, `description`, `current_revision_id`),
no document content — then per entry fetches its current revision
(`getSpecificationSectionRevision`, the v2.1 "show" endpoint) for the PDF's
`url` and runs `unpdf` extraction on it. Each Procore section maps 1:1 to one
cached row under its own `number` as the CSI code; there is **no AI involved
in sync** — an earlier version tried to detect and re-split "combined"
documents (one PDF covering several CSI codes) via an AI pass, but that made
every sync slow and prone to timing out on real documents for a case that's
rare in practice, so it was removed. Staleness is tracked by a SHA-256 hash of
the extracted text (`spec_sections.procore_version`, despite the name) rather
than a specific Procore "last modified" field.

**Verified against a live Procore account** (initially shipped unverified,
since Procore's interactive docs are JS-rendered and didn't return usable
content to fetch tools — confirmed later via the built-in browser tool and a
real sync). Two things Procore's own reference docs get wrong, worth knowing
if this breaks again: (1) `specification_sections`' list endpoint returns only
metadata, not `title`/`text`/`url` as you might assume — the actual document
lives on the revision, fetched separately; (2) the v2.1 revision "show"
endpoint's docs say the response is nested under `data.selected_revision`, but
the live API actually nests it under `data.current_revision`.

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

Logic needed by **both** `src/` and `server/` (e.g. `shared/csi.ts`) goes in
`shared/`, included in both `tsconfig.json` and `tsconfig.node.json`. Keep
those files import-free — that's what lets one file satisfy both the client's
`bundler` resolution and the server's stricter `NodeNext` rules at once.

**A third rule, in `vercel.json`'s `functions` block:** never let two patterns
match the same file — e.g. a broad `"api/**/*.ts"` alongside a specific
`"api/submittals/run.ts"` for that route's `maxDuration`. Vercel then fails the
whole build with *"The pattern ... doesn't match any Serverless Functions"*,
even though the file exists. Every file in `functions` must be matched by
**exactly one** pattern — see the current block for the explicit,
non-overlapping way to give every route `includeFiles` while still giving two
specific routes a longer `maxDuration`.

**A fourth: Vercel's Hobby plan caps a deployment at 12 Serverless Functions**
(one per file in `api/`, counting recursively). **We're at 12/12 — the cap is
maxed out.** Any new route MUST be added as another action on an existing file
(dispatch on an `action` field in the POST body — see `handleProjectsPost` in
`projectRoutes.ts`, or `handleTasksPost` in `taskRoutes.ts`, for the pattern),
never as a new `api/*.ts` file, until either a file is consolidated away or
the project upgrades off the Hobby plan. Check `find api -name "*.ts" | wc -l`
before adding anything. Routes that only differ by HTTP method already share
one file via `vercelRouteMulti({ GET: ..., POST: ... })` (see
`api/projects/index.ts`, `api/checklist.ts`, `api/flow-reports.ts`, or
`api/tasks.ts`). This is a platform limit, not a code smell — don't
"un-consolidate" these back into separate files later without a reason.

## Color usage

Custom Tailwind colors (see `tailwind.config.js`). Color is meaningful, not
decorative:

| Token | Hex | Use |
| --- | --- | --- |
| `legacy-blue-dark` | `#003058` | Primary nav / header, primary buttons |
| `legacy-blue-light` | `#18385f` | Secondary UI: borders, subtle backgrounds, inactive states |
| `legacy-red` | `#ee3428` | Accent only: active states, key CTAs, alerts, warning banners. |

## Adding a real tool

1. Build the tool's page under `src/pages/` (or a `src/tools/<tool>/` folder).
2. In [`src/tools/registry.ts`](src/tools/registry.ts), set the tool's
   `status: 'active'` and give it a `path`.
3. Add the route in `src/App.tsx` behind `ProtectedRoute`.

The Home grid and `ToolCard` need no changes.

## Project layout

```
shared/                zero-import, dual-tsconfig-safe pure logic (see below)
  csi.ts               normalizeCsiCode() and friends — always compare via this
  categories.ts        the 6 compliance categories, weights, display labels
api/                   thin Vercel adapters (12 of 12 files — Hobby plan caps a
                       deployment at 12; the cap is MAXED, see above; routes
                       that only differ by HTTP verb — or by an `action` field
                       in a POST body — share one file via vercelRouteMulti)
  profile.ts (GET directory; POST upsert + optional { title })
  procore/
    authorize.ts  callback.ts  status.ts  disconnect.ts
  projects/
    index.ts (GET /api/projects; POST dispatches on body.action:
              'sync' | 'star' | 'update')
  checklist.ts (GET status; POST dispatches on body.action: 'toggle' | 'log')
  flow-reports.ts (GET this month's status; POST dispatches on body.action:
                   'save' | 'submit')
  tasks.ts (GET tasks visible to caller; POST dispatches on body.action:
            'create' | 'set-status' | 'delete')
  specs/
    index.ts (GET + POST /api/specs)
  submittals/
    index.ts (GET + POST /api/submittals)  run.ts
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
  procoreApi.ts        generic Procore REST GET (companies, projects, specs)
  projects.ts          sync/list/star/update logic for the project cache
  projectRoutes.ts     the /api/projects handlers (list, and the sync/star/
                       update actions dispatched from handleProjectsPost)
  checklist.ts         status/toggle/log logic for the project checklist
  checklistRoutes.ts   the /api/checklist handlers (status, and the toggle/
                       log actions dispatched from handleChecklistPost)
  flowReports.ts       this-month status/save/submit logic for flow reports
                       (synthesizes a not_started placeholder per project
                       until a real row is saved — no cron, see schema.sql)
  flowReportRoutes.ts  the /api/flow-reports handlers (list, and the save/
                       submit actions dispatched from handleFlowReportsPost)
  tasks.ts             visibility (assigned_to/assigned_by, no RLS backstop —
                       see schema.sql) + create/status/delete logic
  taskRoutes.ts        the /api/tasks handlers (list, and the create/
                       set-status/delete actions dispatched from handleTasksPost)
  pdf.ts               extractPdfText() — unpdf wrapper
  appConfig.ts         getConfidenceThreshold() — reads app_config at request time
  storage.ts           submittal PDF Storage: signed upload URL, download
  specs.ts             spec sync (adaptive per-section vs combined-document
                       splitting) + getOrExtractChecklist() caching
  specRoutes.ts        GET /api/specs (list), POST /api/specs (sync)
  submittals.ts        the full check pipeline (runSubmittalCheck) + scoring
  submittalRoutes.ts   POST/GET /api/submittals (create/get), POST /api/submittals/run
  ai/
    modelConfig.ts     PROMPT_MODEL_CONFIG — provider/model/effort per step
    anthropicClient.ts callAnthropicTool() — forced tool-use, never auto-retries
    usageLog.ts        logAiUsage() -> ai_usage_logs
  prompts/
    specIdentification.ts  specExtraction.ts  complianceCheck.ts  (verbatim)
src/
  components/
    icons.tsx               placeholder tool icons + sidebar icons
    AppShell.tsx            header + sidebar chrome, wraps every protected page
    Sidebar.tsx             collapsible project selector (search, star, refresh)
    UnsavedWorkGuardModal.tsx  confirm-before-switch dialog
    CsiSectionPicker.tsx    search-or-browse-by-division spec section picker
    ProfileMenu.tsx         header avatar + dropdown
    ProcoreConnectionItem.tsx  connect / disconnect / unavailable row
    ProtectedRoute.tsx      auth gate; wraps children in the context providers + AppShell
    ToolCard.tsx            single tool grid entry; links to `tool.path` when active
  contexts/
    ProjectContext.tsx      selected project (persisted), project list, sync state
    UnsavedWorkContext.tsx  hasUnsavedWork/setUnsavedWork — Submittal Checker
                            sets this while a check is running
  lib/
    msalConfig.ts      MSAL config (single-tenant authority) + login scopes
    apiClient.ts       getIdToken() + apiFetch(): call /api with the ID token
    profiles.ts        ensureProfile()
    procore.ts         getProcoreStatus / startProcoreConnect / disconnectProcore
    projects.ts        fetchProjects / syncProjects / setProjectStarred
    submittals.ts      specs + submittal-check client calls, incl. Storage upload
    supabaseClient.ts  browser anon client — used for the signed Storage upload
  pages/
    Home.tsx              protected; tool grid, Procore result banner (no header — AppShell owns that)
    Login.tsx             Microsoft sign-in
    SubmittalChecker.tsx  upload form, pipeline state machine, results view
  tools/
    registry.ts        the tool list rendered by Home
  App.tsx              routes
  main.tsx             MSAL bootstrap + providers
supabase/
  schema.sql           tables + RLS
  migrations/          one-off SQL to run against an existing project
vercel.json            SPA rewrite (everything except /api/* -> index.html);
                       maxDuration: 60 on the two AI-heavy routes
```

## Deploying to Vercel

- `vercel.json` handles the SPA history-mode rewrite; `api/` is auto-detected.
- Set all env vars (including `VITE_*` and `SUPABASE_SERVICE_ROLE_KEY`) in the
  Vercel project.
- Register the deployed origin as a **Single-page application** redirect URI in
  the Azure app registration (and set `VITE_AZURE_REDIRECT_URI` to match).
