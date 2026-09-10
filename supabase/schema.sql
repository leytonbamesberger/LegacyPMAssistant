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

-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- Auth is via MSAL (Microsoft), not Supabase Auth, so the browser has no
-- Supabase identity. The browser therefore does NOT touch these tables at all.
--
-- Writes go through `POST /api/profile` (see server/profileHandler.ts), which:
--   1. verifies the caller's Microsoft ID token (issuer = our tenant,
--      audience = our client ID, signature via Microsoft's JWKS), then
--   2. upserts using the Supabase service-role key, which bypasses RLS.
--
-- So RLS is enabled with NO policies: the public anon key (which ships in the
-- JS bundle) can neither read nor write these tables. Only the service-role
-- key — server-side only, never exposed to the browser — can.

alter table profiles enable row level security;
alter table procore_connections enable row level security;

-- If you later need the browser to READ some non-sensitive public data, add a
-- narrow SELECT policy to that specific table only, e.g.:
--   create policy "public read" on <table> for select to anon using (true);
-- ---------------------------------------------------------------------------
