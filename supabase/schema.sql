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

-- spec_sections: raw spec text cached per project + normalized CSI section
-- (see shared/csi.ts — always compare the normalized `csi_code`, never a raw
-- string). Populated by POST /api/specs/sync using the caller's own Procore
-- token; `procore_version` is Procore's own last-modified/revision marker,
-- compared on the next sync to decide whether a section actually changed.
create table spec_sections (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) not null,
  csi_code text not null,
  csi_code_display text,        -- original "22 13 13"-style form, for the UI
  title text,
  raw_text text not null,
  procore_version text,
  synced_at timestamptz not null default now(),
  unique (project_id, csi_code)
);

create index spec_sections_project_id_idx on spec_sections (project_id);

-- spec_checklists: the AI-extracted requirement checklist per project +
-- section (Specification Extraction prompt output). `source_spec_version` is
-- copied from spec_sections.procore_version at extraction time — a mismatch
-- against the current value means the checklist is stale and gets re-extracted.
create table spec_checklists (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) not null,
  csi_code text not null,
  checklist jsonb not null,
  source_spec_version text,
  extracted_at timestamptz not null default now(),
  unique (project_id, csi_code)
);

create index spec_checklists_project_id_idx on spec_checklists (project_id);

-- app_config: small tunable settings (e.g. the AI confidence threshold) that
-- shouldn't need a redeploy to change. Edit values directly in the SQL editor.
create table app_config (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

insert into app_config (key, value) values ('confidence_threshold', '80');

-- submittal_checks: one row per uploaded submittal and its compliance result.
create table submittal_checks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) not null,
  profile_id uuid references profiles(id) not null,
  csi_section text,                       -- normalized code actually used
  filename text,
  file_path text,                         -- Storage path: submittals/{project_id}/{id}.pdf
  status text not null default 'pending', -- pending | completed | failed | multi_product
  category_results jsonb,                 -- Compliance Check prompt output
  score_percent numeric,                  -- null when every category was N/A
  section_confidence numeric,             -- from the Spec Identification step
  section_source text,                    -- 'ai_detected' | 'user_selected'
  low_confidence_warning boolean not null default false,
  error_message text,                     -- set when status = 'failed'
  created_at timestamptz not null default now()
);

create index submittal_checks_project_id_idx on submittal_checks (project_id);

-- ai_usage_logs: one row per AI call made while running a submittal check —
-- lets cost be tracked and attributed per model/step.
create table ai_usage_logs (
  id uuid primary key default gen_random_uuid(),
  submittal_check_id uuid references submittal_checks(id),
  profile_id uuid references profiles(id),
  prompt_type text not null,   -- 'specIdentification' | 'specExtraction' | 'specSplit' | 'complianceCheck'
  provider text not null,
  model text not null,
  input_tokens integer,
  output_tokens integer,
  estimated_cost_usd numeric,
  created_at timestamptz not null default now()
);

create index ai_usage_logs_submittal_check_id_idx on ai_usage_logs (submittal_check_id);

-- Storage: private bucket for uploaded submittal PDFs. The upload flow uses a
-- service-role-issued *signed upload URL* — the browser never gets storage
-- credentials of its own, so (like every other table here) no storage.objects
-- RLS policy is added; the signed token itself is what authorizes the one
-- write it's scoped to.
insert into storage.buckets (id, name, public)
values ('submittals', 'submittals', false)
on conflict (id) do nothing;

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
alter table spec_sections enable row level security;
alter table spec_checklists enable row level security;
alter table app_config enable row level security;
alter table submittal_checks enable row level security;
alter table ai_usage_logs enable row level security;

-- If you later need the browser to READ some non-sensitive public data, add a
-- narrow SELECT policy to that specific table only, e.g.:
--   create policy "public read" on <table> for select to anon using (true);
--
-- Note on submittal_checks visibility: like `projects`, this is a shared,
-- everyone-sees-everything model — GET /api/submittals returns checks for the
-- whole project regardless of which profile ran them, not just the caller's
-- own. There's no per-user restriction to express as an RLS policy here since
-- (as above) the browser never reaches this table directly at all.
-- ---------------------------------------------------------------------------
