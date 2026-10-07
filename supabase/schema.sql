-- Legacy PM Assistant — database schema
--
-- A clean snapshot of the LIVE database as of 2026-10-05 plus migrations 005 and 006
-- (verified column-for-column against the live column listing). Run top to bottom on a
-- FRESH Supabase project. An existing database is changed with the numbered files in
-- supabase/migrations/ instead — never re-run this file against live data.
--
-- Not Postgres enums: every "enum" below is text + a CHECK constraint (the live database
-- has no enum types). Access model: Row Level Security is enabled with no policies of our
-- own on every table (see the bottom), and all reads/writes go through /api/* with the
-- service-role key.

-- ---------------------------------------------------------------------------
-- profiles: one row per Legacy Mechanical user
-- ---------------------------------------------------------------------------
create table profiles (
  id uuid primary key default gen_random_uuid(),
  azure_oid text unique not null,       -- Azure AD object ID, stable identifier
  email text not null,
  display_name text,
  created_at timestamptz default now(),
  -- Self-reported PM/APM role. Not a permission tier; it feeds the Add -> auto-assign
  -- logic (setProjectStarred in server/projects.ts).
  title text check (title in ('pm', 'apm')),
  -- No longer used (it belonged to the old user_overview_projects seeding); kept so existing rows and
  -- the live database line up.
  overview_seeded boolean not null default false,
  -- The Overview's "Choose a View" selection (see shared/overviewView.ts): mine = every Added project
  -- (live), pm_ids = every project of these people (follows reassignment), project_ids = individual
  -- picks. The Overview shows the union.
  overview_view jsonb not null default '{"mine": true, "pm_ids": [], "project_ids": []}'::jsonb
);

-- procore_connections: per-user Procore OAuth tokens, written only by
-- /api/procore/callback (service-role). One row per profile.
create table procore_connections (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references profiles(id) not null unique,
  access_token text,
  refresh_token text,
  expires_at timestamptz,
  connected_at timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- projects: cached mirror of Procore projects, refreshed by /api/projects sync using each
-- user's own Procore token. Shared across all users. The dashboard-only fields (gc, status,
-- pm/apm, ...) are layered on top.
-- ---------------------------------------------------------------------------
create table projects (
  id uuid primary key default gen_random_uuid(),
  procore_project_id bigint unique not null,
  procore_company_id bigint not null,
  job_number text,
  name text not null,
  procore_active boolean not null default true,  -- Procore's own active flag (best-effort)
  is_active boolean not null default true,       -- soft-delete: false once absent from a sync
  last_synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  gc text,
  status text not null default 'active' check (status in ('active', 'closing', 'closed')),
  pm_id uuid references profiles(id),
  apm_id uuid references profiles(id),
  checklist_enabled boolean not null default true,
  -- Set by the initiation wizard (POST /api/projects { action: 'initiate' }).
  initiated boolean not null default false
);

create index projects_is_active_idx on projects (is_active);
create index projects_pm_id_idx on projects (pm_id);
create index projects_apm_id_idx on projects (apm_id);

-- user_starred_projects: a user's "Added" projects (the app's UI says Added; the table keeps
-- its original name). Adding is also the PM/APM claim gesture — done in application code.
create table user_starred_projects (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references profiles(id) not null,
  project_id uuid references projects(id) not null,
  starred_at timestamptz not null default now(),
  unique (profile_id, project_id)
);

create index user_starred_projects_profile_id_idx on user_starred_projects (profile_id);

-- ---------------------------------------------------------------------------
-- Checklist catalog
-- ---------------------------------------------------------------------------

-- checklist_items: the menu the initiation wizard picks from. project_id is null for the
-- shared defaults, or set for one project's own custom item. Completion lives in `tasks`.
-- (The old Budget items — Forecasted / Projections Updated / Snapshots Taken / Sent to ERP —
-- are NOT here any more: they are checkboxes on flow_reports.)
create table checklist_items (
  id uuid primary key default gen_random_uuid(),
  phase text not null check (phase in ('setup', 'recurring', 'closeout')),
  name text not null,
  sort_order int not null,
  cadence_days int,                      -- default cadence for rolling recurring items
  cadence_type text check (cadence_type in ('rolling', 'calendar_month')),
  project_id uuid references projects(id),
  -- The four meeting Setup items: the only ones that may be left TBD in the wizard.
  is_meeting boolean not null default false
);

create index checklist_items_project_id_idx on checklist_items (project_id);

insert into checklist_items (phase, name, sort_order, cadence_days, cadence_type, is_meeting) values
  ('setup', 'Job Setup Sheet', 1, null, null, false),
  ('setup', 'Block Party', 2, null, null, true),
  ('setup', 'Kick-off Meeting', 3, null, null, true),
  ('setup', 'Notification Timelines', 4, null, null, false),
  ('setup', 'Budget Import', 5, null, null, false),
  ('setup', 'Cx and Startup Service Forms (sent)', 6, null, null, false),
  ('setup', 'Strong Finish Meeting', 7, null, null, true),
  ('setup', 'Service/Client Intro & PM Agreement', 8, null, null, false),
  ('setup', 'Closeout Meeting', 9, null, null, true),
  ('setup', 'Productivity Tracking', 10, null, null, false),
  ('setup', 'Submittals Requested', 11, null, null, false),
  ('setup', 'Permits Pulled', 12, null, null, false),
  ('setup', 'Subcontracts Issued', 13, null, null, false),
  ('setup', 'Client Contacts on Daily Log Distribution', 14, null, null, false),
  ('recurring', 'Weekly Project Meeting', 1, 7, 'rolling', false),
  ('recurring', 'Project Schedule Update', 2, 7, 'rolling', false),
  ('recurring', 'Procurement Log Update', 3, 7, 'rolling', false),
  ('recurring', 'Open Change Events', 4, 7, 'rolling', false),
  ('recurring', 'Site Walk', 5, 7, 'rolling', false),
  ('recurring', 'AR Spreadsheet Updates', 6, 7, 'rolling', false),
  ('closeout', 'Custom Feedback Survey Sent', 1, null, null, false),
  ('closeout', 'Timesheets Disabled in Procore', 2, null, null, false),
  ('closeout', 'Customer Letter of Rec.', 3, null, null, false);

-- A project hiding one of the shared defaults from its own list.
create table project_checklist_item_exclusions (
  project_id uuid references projects(id) not null,
  checklist_item_id uuid references checklist_items(id) not null,
  primary key (project_id, checklist_item_id)
);

-- Per-project configuration chosen in the initiation wizard. Written once; afterwards the
-- generated `tasks` rows own the live dates.
create table project_checklist_item_config (
  project_id uuid references projects(id) not null,
  checklist_item_id uuid references checklist_items(id) not null,
  due_date date,
  is_tbd boolean not null default false,
  cadence_value int check (cadence_value > 0),
  cadence_unit text check (cadence_unit in ('day', 'week', 'month')),
  start_date date,
  time_of_day time,                      -- no longer collected (recurring items are date-only); kept for old rows
  primary key (project_id, checklist_item_id)
);

-- ---------------------------------------------------------------------------
-- flow_reports: one row per project per month. `answers` holds one key per FLOW-letter
-- question, so the question set can change without a migration. The four budget_* booleans
-- are the "Monthly budget checklist" at the bottom of the form (optional, never required to
-- submit); the PDF cover and the Overview read them.
-- ---------------------------------------------------------------------------
create table flow_reports (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) not null,
  month date not null,
  status text not null default 'not_started' check (status in ('not_started', 'in_progress', 'completed')),
  answers jsonb,
  submitted_by uuid references profiles(id),
  submitted_at timestamptz,
  margin_fade_notes text,    -- non-empty values feed the PDF's "Flagged Items"
  underbilled_notes text,
  attn text,
  company text,
  budget_forecasted boolean not null default false,
  budget_projections_updated boolean not null default false,
  budget_snapshots_taken boolean not null default false,
  budget_sent_to_erp boolean not null default false,
  unique (project_id, month)
);

create index flow_reports_project_id_idx on flow_reports (project_id);

-- ---------------------------------------------------------------------------
-- tasks. IMPORTANT: unlike every other table, `tasks` has a real per-row visibility rule
-- (only an assignee or the assigner can see a row) — but with no Supabase Auth session to key
-- an RLS policy on, it is enforced in server/tasks.ts, not in Postgres.
--
-- type is set by the server (person / project / personal), never asked for.
-- source_category is set only on generated tasks — initiation ('setup' | 'recurring') or the Closeout
-- Project wizard ('closeout'); null for manual tasks. Flow reports are NOT tasks: the Tasks page computes one "FLOW Reports (n)" row.
-- A task IS the completion record for a checklist item. Completing a recurring task creates a NEW
-- row for the next cycle (due = old due + cadence). is_tbd + due_date null = "date to be decided".
-- ---------------------------------------------------------------------------
create table tasks (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('project', 'person', 'personal')),
  project_id uuid references projects(id),
  title text not null,
  description text,
  due_date date,
  status text not null default 'not_started' check (status in ('not_started', 'in_progress', 'complete')),
  assigned_by uuid references profiles(id),
  visibility text not null default 'private' check (visibility in ('private', 'public')),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  is_recurring boolean not null default false,
  notes text,
  checklist_item_id uuid references checklist_items(id),
  source_category text check (source_category in ('setup', 'recurring', 'closeout')),
  cadence_value int check (cadence_value > 0),
  cadence_unit text check (cadence_unit in ('day', 'week', 'month')),
  is_tbd boolean not null default false,
  due_time time,
  -- Meeting tasks only (checklist_items.is_meeting): the date the meeting is/was held. Entering one
  -- completes the task and puts it on the calendar; due_date stays the "Setup complete by" date.
  meeting_date date
);

create index tasks_assigned_by_idx on tasks (assigned_by);
create index tasks_project_id_idx on tasks (project_id);
create index tasks_checklist_item_id_idx on tasks (checklist_item_id);

-- A task can have several assignees but ONE shared status for the whole task.
create table task_assignees (
  task_id uuid references tasks(id) on delete cascade not null,
  user_id uuid references profiles(id) not null,
  primary key (task_id, user_id)
);

create index task_assignees_user_id_idx on task_assignees (user_id);

-- ---------------------------------------------------------------------------
-- Submittal checker
-- ---------------------------------------------------------------------------

-- spec_sections: raw spec text cached per project + normalized CSI section (see shared/csi.ts;
-- always compare the normalized `csi_code`). `procore_version` is Procore's own revision marker.
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

-- spec_checklists: the AI-extracted requirement checklist per project + section.
-- `source_spec_version` is copied from spec_sections.procore_version at extraction time.
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

-- app_config: small tunable settings that shouldn't need a redeploy to change.
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

-- ai_usage_logs: one row per AI call made while running a submittal check.
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

-- Storage: private bucket for uploaded submittal PDFs. Uploads use a service-role-issued signed
-- upload URL, so no storage.objects policy is needed — the signed token authorizes the one write.
insert into storage.buckets (id, name, public)
values ('submittals', 'submittals', false)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- Auth is Microsoft (MSAL), not Supabase Auth, so the browser has no Supabase identity and no
-- policy keyed on `authenticated` could ever match. Instead every request goes through our own
-- /api handlers, which verify the Microsoft ID token and then use the service-role key (bypasses
-- RLS). RLS is therefore ENABLED with NO policies of our own on every table: the public anon key
-- (shipped in the JS bundle) can neither read nor write anything.
-- ---------------------------------------------------------------------------

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
alter table project_checklist_item_config enable row level security;
alter table project_checklist_item_exclusions enable row level security;
alter table flow_reports enable row level security;
alter table tasks enable row level security;
alter table task_assignees enable row level security;

-- NOTE — policies that exist on the LIVE database but are not created here (they came from the
-- Supabase dashboard, are inert for this app, and their definitions weren't in the column listing):
--   profiles:             "Users can update their own profile" (UPDATE)
--                         "Users can insert their own profile" (INSERT)
--                         "Authenticated users can read all profiles" (SELECT)
--   procore_connections:  "Users can manage their own Procore connection" (ALL)
-- Migration 005 has an optional, commented-out DROP POLICY IF EXISTS block for them. To inspect:
--   select policyname, cmd, roles, qual, with_check from pg_policies
--   where tablename in ('profiles', 'procore_connections');
--
-- tasks is the one table where "RLS enabled, no policies" is NOT the same as "no visibility
-- restriction" — see the comment on `tasks` above (enforced in server/tasks.ts).
