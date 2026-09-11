-- Run once in the Supabase SQL editor against an existing project.
-- Adds the project cache + per-user starred list for the sidebar project selector.

create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  procore_project_id bigint unique not null,
  procore_company_id bigint not null,
  job_number text,
  name text not null,
  procore_active boolean not null default true,
  is_active boolean not null default true,
  last_synced_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists projects_is_active_idx on projects (is_active);

create table if not exists user_starred_projects (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references profiles(id) not null,
  project_id uuid references projects(id) not null,
  starred_at timestamptz not null default now(),
  unique (profile_id, project_id)
);

create index if not exists user_starred_projects_profile_id_idx
  on user_starred_projects (profile_id);

-- No client-side access — same pattern as every other table. All reads/writes
-- go through /api/projects* using the Supabase service-role key.
alter table projects enable row level security;
alter table user_starred_projects enable row level security;
