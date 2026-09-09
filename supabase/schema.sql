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

-- procore_connections: placeholder for per-user Procore OAuth tokens (not wired up yet)
create table procore_connections (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references profiles(id) not null,
  access_token text,
  refresh_token text,
  expires_at timestamptz,
  connected_at timestamptz default now()
);

create index procore_connections_profile_id_idx on procore_connections (profile_id);

-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- Auth is via MSAL (Microsoft), not Supabase Auth, so there is no Supabase JWT
-- carrying the user's identity yet. For the POC the app uses the anon key and
-- these tables are reached directly from the client.
--
-- Before this leaves POC status, lock these down — options:
--   * Move profile upsert + token storage behind an Edge Function / server
--     route that validates the MSAL ID token, and deny direct client access.
--   * Or mint a Supabase JWT from the verified Azure identity and write RLS
--     policies keyed on azure_oid.
--
-- Enabling RLS with no policies (deny-all) until then:
-- alter table profiles enable row level security;
-- alter table procore_connections enable row level security;
-- ---------------------------------------------------------------------------
