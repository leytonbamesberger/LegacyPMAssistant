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

-- title: self-reported PM/APM role, set by the user on first login (see
-- ProfileMenu). Not a permission tier — every authenticated user has full
-- read/write access everywhere. It only feeds the star -> auto-assign logic
-- on `projects` below (setProjectStarred in server/projects.ts).
alter table profiles add column title text check (title in ('pm', 'apm'));

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

-- Project checklist / flow-report dashboard fields, layered onto the
-- Procore-synced project cache above (job_number/name already exist there).
alter table projects
  add column gc text,
  add column status text not null default 'active' check (status in ('active', 'closing', 'closed')),
  add column pm_id uuid references profiles(id),
  add column apm_id uuid references profiles(id),
  add column checklist_enabled boolean not null default true;

create index projects_pm_id_idx on projects (pm_id);
create index projects_apm_id_idx on projects (apm_id);

-- user_starred_projects: which projects a profile has starred for quick access.
create table user_starred_projects (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references profiles(id) not null,
  project_id uuid references projects(id) not null,
  starred_at timestamptz not null default now(),
  unique (profile_id, project_id)
);

create index user_starred_projects_profile_id_idx on user_starred_projects (profile_id);

-- Starring a project is also the PM/APM claim gesture: when a `pm` stars a
-- project with no pm_id (or an `apm` stars one with no apm_id), the server
-- sets that assignment. Implemented in setProjectStarred (server/projects.ts),
-- not here — both fields stay reassignable afterward via a plain UPDATE from
-- the project card, open to anyone regardless of `title`.

-- checklist_items: master checklist definitions, seeded once below and
-- shared across every project (not per-project rows). cadence_days is only
-- set on `weekly` items and drives staleness in project_checklist_log.
create table checklist_items (
  id uuid primary key default gen_random_uuid(),
  phase text not null check (phase in ('setup', 'weekly', 'closeout')),
  name text not null,
  sort_order int not null,
  cadence_days int
);

-- project_checklist_log: one row per completion event. For setup/closeout
-- items, the presence of any row = done. For weekly items this is a running
-- history — checking one off inserts a new row rather than updating the
-- existing one, and staleness compares now() against the most recent row's
-- completed_at.
create table project_checklist_log (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) not null,
  checklist_item_id uuid references checklist_items(id) not null,
  completed_at timestamptz not null default now(),
  completed_by uuid references profiles(id) not null
);

create index project_checklist_log_project_id_idx on project_checklist_log (project_id);
create index project_checklist_log_checklist_item_id_idx on project_checklist_log (checklist_item_id);

-- flow_reports: one row per project per month. `answers` holds one key per
-- FLOW-letter question (Change Proposals, RFIs, Submittals, Applications for
-- Payment, Field Orders/T&M, Items Due to You From Legacy, Schedule
-- Acknowledgment, Other) — no fixed columns per question, so the question set
-- can change without a migration.
create table flow_reports (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) not null,
  month date not null,
  status text not null default 'not_started' check (status in ('not_started', 'in_progress', 'completed')),
  answers jsonb,
  submitted_by uuid references profiles(id),
  submitted_at timestamptz,
  due_date date,
  unique (project_id, month)
);

create index flow_reports_project_id_idx on flow_reports (project_id);

-- tasks: type = 'project' | 'person' | 'personal'. project_id is settable
-- regardless of type (a personal task can still reference a project).
-- assigned_by is null for system-generated or personal tasks, set for
-- person-to-person assignment. visibility is only meaningful for
-- type = 'personal'.
--
-- IMPORTANT: unlike every other table in this file, `tasks` has a real
-- per-row visibility rule (only assigned_to/assigned_by can see a row) — but
-- this app has no Supabase Auth session to key an RLS policy on (see the RLS
-- section below), so that rule is NOT expressed as a Postgres policy. It is
-- enforced in server/tasks.ts by filtering the query on the caller's
-- profileId, the same way getProjectsForProfile already does. RLS is still
-- enabled with no policies here for consistency, not as the access boundary.
create table tasks (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('project', 'person', 'personal')),
  project_id uuid references projects(id),
  title text not null,
  description text,
  due_date date,
  status text not null default 'open' check (status in ('open', 'done')),
  assigned_to uuid references profiles(id) not null,
  assigned_by uuid references profiles(id),
  visibility text not null default 'private' check (visibility in ('private', 'public')),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index tasks_assigned_to_idx on tasks (assigned_to);
create index tasks_assigned_by_idx on tasks (assigned_by);
create index tasks_project_id_idx on tasks (project_id);

-- Seed the master checklist (mirrors the existing spreadsheet categories).
-- Run once; re-running is safe to skip if rows already exist.
insert into checklist_items (phase, name, sort_order, cadence_days) values
  ('setup', 'Job Setup Sheet', 1, null),
  ('setup', 'Block Party', 2, null),
  ('setup', 'Kick-off Meeting', 3, null),
  ('setup', 'Notification Timelines', 4, null),
  ('setup', 'Budget Import', 5, null),
  ('setup', 'Cx and Startup Service Forms (sent)', 6, null),
  ('setup', 'Strong Finish Meeting', 7, null),
  ('setup', 'Service/Client Intro & PM Agreement', 8, null),
  ('setup', 'Closeout Meeting', 9, null),
  ('setup', 'Productivity Tracking', 10, null),
  ('setup', 'Submittals Requested', 11, null),
  ('setup', 'Permits Pulled', 12, null),
  ('setup', 'Subcontracts Issued', 13, null),
  ('setup', 'Client Contacts on Daily Log Distribution', 14, null),
  ('weekly', 'Weekly Project Meeting', 1, 7),
  ('weekly', 'Project Schedule Update', 2, 7),
  ('weekly', 'Procurement Log Update', 3, 7),
  ('weekly', 'Open Change Events', 4, 7),
  ('weekly', 'Site Walk', 5, 7),
  ('weekly', 'AR Spreadsheet Updates', 6, 7),
  ('closeout', 'Custom Feedback Survey Sent', 1, null),
  ('closeout', 'Timesheets Disabled in Procore', 2, null),
  ('closeout', 'Customer Letter of Rec.', 3, null);

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
  prompt_type text not null,   -- 'specIdentification' | 'specExtraction' | 'complianceCheck'
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
alter table checklist_items enable row level security;
alter table project_checklist_log enable row level security;
alter table flow_reports enable row level security;
alter table tasks enable row level security;

-- tasks is the one table above where "RLS enabled, no policies" is NOT the
-- same as "no visibility restriction" — see the comment on `tasks` itself.
-- The restriction is real, it's just enforced in server/tasks.ts instead of
-- in Postgres, because this app has no Supabase Auth session to check
-- against (MSAL-only auth — see the top of this section).

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
