-- 005 — Budget checklist moves into flow reports; flow tasks retired; meetings flagged.
--
-- Written against the LIVE database (column listing pasted 2026-10-05), not schema.sql.
-- Safe to run more than once: every step is IF NOT EXISTS / IF EXISTS, constraint changes
-- are guarded by looking at what is actually there, and the optional destructive reset at
-- the bottom is commented out. One transaction: a failure changes nothing.
--
-- WHAT THE LIVE DATABASE ALREADY HAS (nothing to do for these)
--   projects.initiated; task_assignees; project_checklist_item_config;
--   project_checklist_item_exclusions; user_overview_projects; profiles.overview_seeded;
--   the tasks overhaul (notes, checklist_item_id, source_category, cadence_*, is_tbd,
--   due_time; assigned_to / last_completed_at / cadence_days gone); project_checklist_log
--   and project_checklist_schedule already dropped.
--
-- WHAT IS MISSING OR DIFFERENT, AND WHAT THIS DOES ABOUT IT
--   1. checklist_items.is_meeting does not exist        -> added; set on the 4 meeting items.
--   2. flow_reports has no budget_* columns             -> 4 boolean columns added (default false).
--   3. tasks.related_flow_month still exists            -> its unique index and the column are dropped.
--   4. tasks.source_category still allows 'flow'        -> flow task rows deleted (flow reports
--      are no longer tasks), then the check is replaced with ('setup', 'recurring').
--   5. The 4 Budget items are still in the catalog      -> removed, together with the tasks / config
--      / exclusions that point at them (they would otherwise be orphans the wizard can't handle).
--   6. Constraints / indexes / RLS flags can't be seen in the column listing -> re-asserted below
--      with guarded, idempotent statements (the upserts in the server need the unique keys).
--
-- DELIBERATELY NOT DONE: wiping initiation data. At the time of writing the live database had
-- 10 initiated projects with 108 setup tasks (97 complete). Those are kept. The full reset from
-- the earlier plan is at the very bottom, commented out, in case you do want it.
--
-- DELIBERATELY NOT TOUCHED: the 4 RLS policies that exist live on profiles and
-- procore_connections ("Users can update their own profile", "Users can insert their own
-- profile", "Authenticated users can read all profiles", "Users can manage their own Procore
-- connection"). The app never uses them (no Supabase Auth session), so they're inert; the
-- optional DROP POLICY lines at the bottom remove them if you want the "no policies" design.

begin;

-- ---------------------------------------------------------------------------
-- 1. Meetings are flagged on the catalog (the wizard stops recognising them by name)
-- ---------------------------------------------------------------------------

alter table checklist_items add column if not exists is_meeting boolean not null default false;

update checklist_items
  set is_meeting = true
  where project_id is null
    and phase = 'setup'
    and name in ('Block Party', 'Kick-off Meeting', 'Strong Finish Meeting', 'Closeout Meeting')
    and is_meeting is distinct from true;

-- ---------------------------------------------------------------------------
-- 2. Flow reports carry the monthly budget checklist
-- ---------------------------------------------------------------------------

alter table flow_reports
  add column if not exists budget_forecasted boolean not null default false,
  add column if not exists budget_projections_updated boolean not null default false,
  add column if not exists budget_snapshots_taken boolean not null default false,
  add column if not exists budget_sent_to_erp boolean not null default false;

-- ---------------------------------------------------------------------------
-- 3. Retire the four Budget checklist items (they are checkboxes on the flow report now)
-- ---------------------------------------------------------------------------

delete from task_assignees
  where task_id in (
    select t.id from tasks t
    join checklist_items c on c.id = t.checklist_item_id
    where c.project_id is null and c.phase = 'recurring'
      and c.name in ('Forecasted', 'Projections Updated', 'Snapshots Taken', 'Sent to ERP')
  );
delete from tasks
  where checklist_item_id in (
    select id from checklist_items
    where project_id is null and phase = 'recurring'
      and name in ('Forecasted', 'Projections Updated', 'Snapshots Taken', 'Sent to ERP')
  );
delete from project_checklist_item_config
  where checklist_item_id in (
    select id from checklist_items
    where project_id is null and phase = 'recurring'
      and name in ('Forecasted', 'Projections Updated', 'Snapshots Taken', 'Sent to ERP')
  );
delete from project_checklist_item_exclusions
  where checklist_item_id in (
    select id from checklist_items
    where project_id is null and phase = 'recurring'
      and name in ('Forecasted', 'Projections Updated', 'Snapshots Taken', 'Sent to ERP')
  );
delete from checklist_items
  where project_id is null and phase = 'recurring'
    and name in ('Forecasted', 'Projections Updated', 'Snapshots Taken', 'Sent to ERP');

-- ---------------------------------------------------------------------------
-- 4. Flow tasks are no longer rows in tasks
-- ---------------------------------------------------------------------------

-- Flow reports are computed from flow_reports now; any stored flow task is obsolete.
delete from task_assignees where task_id in (select id from tasks where source_category = 'flow');
delete from tasks where source_category = 'flow';

drop index if exists tasks_flow_project_month_uniq;
alter table tasks drop column if exists related_flow_month;

-- source_category check: replace any check that still lists 'flow', add it if absent.
do $$
declare
  c record;
  has_current boolean := false;
begin
  for c in
    select conname, pg_get_constraintdef(oid) as def
    from pg_constraint
    where conrelid = 'public.tasks'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%source_category%'
  loop
    if c.def ilike '%flow%' then
      execute format('alter table public.tasks drop constraint %I', c.conname);
    else
      has_current := true;
    end if;
  end loop;
  if not has_current then
    alter table public.tasks
      add constraint tasks_source_category_check check (source_category in ('setup', 'recurring'));
  end if;
end $$;

-- status check: not_started | in_progress | complete (replace a stale open/done or completed variant).
do $$
declare
  c record;
  has_current boolean := false;
begin
  for c in
    select conname, pg_get_constraintdef(oid) as def
    from pg_constraint
    where conrelid = 'public.tasks'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
  loop
    if c.def ilike '%not_started%' and c.def ilike '%in_progress%' and c.def ilike '%complete%' then
      has_current := true;
    else
      execute format('alter table public.tasks drop constraint %I', c.conname);
    end if;
  end loop;
  if not has_current then
    alter table public.tasks
      add constraint tasks_status_check check (status in ('not_started', 'in_progress', 'complete'));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Keys and indexes the code relies on (the column listing can't show them)
--    Each is added only if no unique index/PK over those exact columns exists yet.
-- ---------------------------------------------------------------------------

do $$
declare
  spec record;
  have boolean;
begin
  for spec in
    select * from (values
      ('task_assignees',                    array['task_id', 'user_id'],              'task_assignees_pkey',                    'primary key'),
      ('project_checklist_item_config',     array['project_id', 'checklist_item_id'], 'project_checklist_item_config_pkey',     'primary key'),
      ('project_checklist_item_exclusions', array['project_id', 'checklist_item_id'], 'project_checklist_item_exclusions_pkey', 'primary key'),
      ('user_overview_projects',            array['user_id', 'project_id'],           'user_overview_projects_pkey',            'primary key'),
      ('flow_reports',                      array['project_id', 'month'],             'flow_reports_project_id_month_key',      'unique'),
      ('user_starred_projects',             array['profile_id', 'project_id'],        'user_starred_projects_profile_id_project_id_key', 'unique')
    ) as v(tbl, cols, conname, kind)
  loop
    select exists (
      select 1
      from pg_index i
      where i.indrelid = format('public.%I', spec.tbl)::regclass
        and i.indisunique
        and (
          select array_agg(a.attname::text order by a.attname)
          from pg_attribute a
          where a.attrelid = i.indrelid and a.attnum = any (i.indkey)
        ) = (select array_agg(x order by x) from unnest(spec.cols) x)
    ) into have;
    if not have then
      execute format('alter table public.%I add constraint %I %s (%s)',
        spec.tbl, spec.conname, spec.kind,
        (select string_agg(quote_ident(x), ', ') from unnest(spec.cols) x));
    end if;
  end loop;
end $$;

create index if not exists task_assignees_user_id_idx on task_assignees (user_id);
create index if not exists tasks_checklist_item_id_idx on tasks (checklist_item_id);
create index if not exists tasks_assigned_by_idx on tasks (assigned_by);
create index if not exists tasks_project_id_idx on tasks (project_id);
create index if not exists flow_reports_project_id_idx on flow_reports (project_id);

-- ---------------------------------------------------------------------------
-- 6. Row Level Security: enabled with no policies of our own on every app table, so the public
--    anon key can't read or write anything. (Idempotent; re-asserts it for the newer tables.)
-- ---------------------------------------------------------------------------

alter table profiles enable row level security;
alter table procore_connections enable row level security;
alter table projects enable row level security;
alter table user_starred_projects enable row level security;
alter table user_overview_projects enable row level security;
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

commit;

-- ===========================================================================
-- OPTIONAL — run separately, only if you want it. Both are commented out.
-- ===========================================================================

-- A) Drop the 4 inert dashboard-made policies (matches the "no policies" design in schema.sql).
--    Their definitions weren't in the pasted listing; if you want a record first:
--      select policyname, cmd, roles, qual, with_check from pg_policies
--      where tablename in ('profiles', 'procore_connections');
--
-- drop policy if exists "Users can update their own profile" on profiles;
-- drop policy if exists "Users can insert their own profile" on profiles;
-- drop policy if exists "Authenticated users can read all profiles" on profiles;
-- drop policy if exists "Users can manage their own Procore connection" on procore_connections;

-- B) Full initiation reset (DESTRUCTIVE — deletes the live initiation work: every project goes
--    back to uninitiated, all setup/recurring tasks, config, exclusions and custom items are
--    deleted). Kept: profiles, projects, Added lists, flow reports, Overview selections, manual tasks.
--
-- begin;
-- update projects set initiated = false;
-- delete from task_assignees where task_id in (select id from tasks where source_category is not null);
-- delete from tasks where source_category is not null;
-- delete from project_checklist_item_config;
-- delete from project_checklist_item_exclusions;
-- delete from checklist_items where project_id is not null;
-- commit;

-- ===========================================================================
-- Afterwards, to confirm (read-only):
--   select column_name from information_schema.columns
--     where table_name = 'checklist_items' and column_name = 'is_meeting';        -- 1 row
--   select name from checklist_items where is_meeting order by name;               -- the 4 meetings
--   select count(*) from checklist_items where name in
--     ('Forecasted','Projections Updated','Snapshots Taken','Sent to ERP');        -- 0
--   select count(*) from tasks where source_category = 'flow';                     -- 0
--   select column_name from information_schema.columns
--     where table_name = 'tasks' and column_name = 'related_flow_month';           -- 0 rows
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--     where conrelid = 'public.tasks'::regclass and contype = 'c';                 -- status + source_category
-- ===========================================================================
