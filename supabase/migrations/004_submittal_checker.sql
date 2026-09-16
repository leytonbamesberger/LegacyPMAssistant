-- Run once in the Supabase SQL editor against an existing project.
-- Adds the Submittal Checker's data model: cached spec text/checklists,
-- app config, submittal checks, and AI usage logs — plus the Storage bucket
-- for uploaded submittal PDFs.

create table if not exists spec_sections (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) not null,
  csi_code text not null,
  csi_code_display text,
  title text,
  raw_text text not null,
  procore_version text,
  synced_at timestamptz not null default now(),
  unique (project_id, csi_code)
);

create index if not exists spec_sections_project_id_idx on spec_sections (project_id);

create table if not exists spec_checklists (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) not null,
  csi_code text not null,
  checklist jsonb not null,
  source_spec_version text,
  extracted_at timestamptz not null default now(),
  unique (project_id, csi_code)
);

create index if not exists spec_checklists_project_id_idx on spec_checklists (project_id);

create table if not exists app_config (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

insert into app_config (key, value)
values ('confidence_threshold', '80')
on conflict (key) do nothing;

create table if not exists submittal_checks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) not null,
  profile_id uuid references profiles(id) not null,
  csi_section text,
  filename text,
  file_path text,
  status text not null default 'pending',
  category_results jsonb,
  score_percent numeric,
  section_confidence numeric,
  section_source text,
  low_confidence_warning boolean not null default false,
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists submittal_checks_project_id_idx on submittal_checks (project_id);

create table if not exists ai_usage_logs (
  id uuid primary key default gen_random_uuid(),
  submittal_check_id uuid references submittal_checks(id),
  profile_id uuid references profiles(id),
  prompt_type text not null,
  provider text not null,
  model text not null,
  input_tokens integer,
  output_tokens integer,
  estimated_cost_usd numeric,
  created_at timestamptz not null default now()
);

create index if not exists ai_usage_logs_submittal_check_id_idx
  on ai_usage_logs (submittal_check_id);

insert into storage.buckets (id, name, public)
values ('submittals', 'submittals', false)
on conflict (id) do nothing;

-- Same pattern as every other table: RLS on, no policies. All access goes
-- through /api/specs* and /api/submittals* using the service-role key. File
-- uploads use a service-role-issued signed upload URL, so no storage.objects
-- policy is needed either.
alter table spec_sections enable row level security;
alter table spec_checklists enable row level security;
alter table app_config enable row level security;
alter table submittal_checks enable row level security;
alter table ai_usage_logs enable row level security;
