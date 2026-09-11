-- Legacy PM Assistant — database schema
-- Apply manually (Supabase SQL editor or `psql`). Not run automatically.

-- profiles: one row per Legacy Mechanical user
create table profiles (
  id uuid primary key default gen_random_uuid(),
  azure_oid text unique not null,       -- Azure AD object ID, stable identifier
  email text not null,
  display_name text,
  created_at timestamptz default now()
);

-- procore_connections: per-user Procore OAuth tokens.
-- Written only by /api/procore/callback (service-role). One row per profile.
-- Tokens are stored as-is; access is limited to the service-role key (RLS
-- below). Encrypting at rest is a reasonable future hardening step.
create table procore_connections (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references profiles(id) not null unique,
  access_token text,
  refresh_token text,
  expires_at timestamptz,
  connected_at timestamptz default now()
);

-- projects: cached mirror of Procore projects, refreshed by /api/projects/sync
-- using each user's own Procore OAuth token. One row per Procore project,
-- shared across all users (not per-profile) — everyone sees the same list.
create table projects (
  id uuid primary key default gen_random_uuid(),
  procore_project_id bigint unique not null,
  procore_company_id bigint not null,
  job_number text,
  name text not null,
  procore_active boolean not null default true,  -- Procore's own active/status flag (best-effort)
  is_active boolean not null default true,       -- soft-delete: false once absent from a sync
  last_synced_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index projects_is_active_idx on projects (is_active);

-- user_starred_projects: which projects a profile has starred for quick access.
create table user_starred_projects (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references profiles(id) not null,
  project_id uuid references projects(id) not null,
  starred_at timestamptz not null default now(),
  unique (profile_id, project_id)
);

create index user_starred_projects_profile_id_idx on user_starred_projects (profile_id);

-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- Auth is via MSAL (Microsoft), not Supabase Auth, so the browser has no
-- Supabase identity — there is no "authenticated" role a policy could ever
-- match for requests coming from this app's browser client. So "authenticated
-- users can read/write" is implemented as "verified-Microsoft-token requests
-- through our own API", not as a Supabase RLS policy keyed on `authenticated`.
--
-- Writes go through `POST /api/profile` and the `/api/procore/*` /
-- `/api/projects*` handlers (see server/*.ts), which:
--   1. verify the caller's Microsoft ID token (issuer = our tenant,
--      audience = our client ID, signature via Microsoft's JWKS), then
--   2. read/write using the Supabase service-role key, which bypasses RLS.
--
-- So RLS is enabled with NO policies on every table: the public anon key
-- (which ships in the JS bundle) can neither read nor write any of them. Only
-- the service-role key — server-side only, never exposed to the browser — can.

alter table profiles enable row level security;
alter table procore_connections enable row level security;
alter table projects enable row level security;
alter table user_starred_projects enable row level security;

-- If you later need the browser to READ some non-sensitive public data, add a
-- narrow SELECT policy to that specific table only, e.g.:
--   create policy "public read" on <table> for select to anon using (true);
-- ---------------------------------------------------------------------------
