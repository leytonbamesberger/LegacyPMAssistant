-- 008 — Overview "Choose a View", Closeout tasks
--
-- Run in the Supabase SQL Editor. Idempotent: safe to run more than once. Needs 005 + 006 applied
-- (they are, on live). Everything below is additive — it changes no existing data and drops nothing.
--
--   1. profiles.overview_view   the per-user Overview selection (jsonb) that replaces the
--                               user_overview_projects table
--   2. tasks.source_category    now also allows 'closeout'
--   3. checklist_items          make sure the three closeout-phase items exist (never renames)
--   4. projects.status          confirm 'closing' is allowed (no change — aborts the run if it isn't)
--
-- Step B at the bottom (dropping user_overview_projects) is commented out on purpose: run it only
-- AFTER the new code is deployed, because the code that's live today still reads that table.
--
-- Live state when this was written (read-only look): all three closeout items already exist, every
-- project is 'active', profiles.overview_view does not exist yet, user_overview_projects has 18 rows.

begin;

-- ---------------------------------------------------------------------------
-- 1. profiles.overview_view
--    { "mine": bool, "pm_ids": [profile ids], "project_ids": [project ids] }
--    "mine"        = include all of the user's Added projects (live)
--    "pm_ids"      = include every project whose pm_id is one of these people (follows reassignment)
--    "project_ids" = individually picked projects
--    The Overview shows the union. Existing rows get the default (Added projects only).
-- ---------------------------------------------------------------------------
alter table profiles
  add column if not exists overview_view jsonb not null
  default '{"mine": true, "pm_ids": [], "project_ids": []}'::jsonb;

-- ---------------------------------------------------------------------------
-- 2. tasks.source_category: 'setup' | 'recurring' | 'closeout'
--    It is a text column with a CHECK (not a Postgres enum), so "adding a value" means replacing the
--    check. Any check on source_category that doesn't already list 'closeout' is dropped and the
--    full one added; if one already lists it, nothing happens.
-- ---------------------------------------------------------------------------
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
    if c.def ilike '%closeout%' then
      has_current := true;
    else
      execute format('alter table public.tasks drop constraint %I', c.conname);
    end if;
  end loop;
  if not has_current then
    alter table public.tasks
      add constraint tasks_source_category_check
      check (source_category in ('setup', 'recurring', 'closeout'));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. The three closeout-phase checklist items (shared catalog rows: project_id is null).
--    Matched by phase + name, so an existing row is left exactly as it is (not renamed, not
--    re-ordered); only a missing one is inserted.
-- ---------------------------------------------------------------------------
insert into checklist_items (phase, name, sort_order, cadence_days, cadence_type, project_id, is_meeting)
select v.phase, v.name, v.sort_order, null, null, null, false
from (values
  ('closeout', 'Custom Feedback Survey Sent',   1),
  ('closeout', 'Timesheets Disabled in Procore', 2),
  ('closeout', 'Customer Letter of Rec.',        3)
) as v(phase, name, sort_order)
where not exists (
  select 1 from checklist_items ci
  where ci.phase = v.phase and ci.name = v.name and ci.project_id is null
);

-- ---------------------------------------------------------------------------
-- 4. projects.status already allows 'closing' (active | closing | closed). Not changed here; this
--    only checks, and stops the whole run if some check on projects.status doesn't allow it.
-- ---------------------------------------------------------------------------
do $$
declare
  c record;
  seen boolean := false;
begin
  for c in
    select conname, pg_get_constraintdef(oid) as def
    from pg_constraint
    where conrelid = 'public.projects'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
  loop
    seen := true;
    if c.def not ilike '%closing%' then
      raise exception 'projects.status check % does not allow ''closing'': %', c.conname, c.def;
    end if;
  end loop;
  -- seen = false means there is no check at all, which also allows 'closing'.
end $$;

commit;

-- ---------------------------------------------------------------------------
-- Step B (OPTIONAL, run later): retire user_overview_projects.
--
-- The new code no longer reads or writes it (nothing else in the app references it; the only other
-- mention is migration 005, which has already been run). Do this only once the new version is
-- deployed — until then the old Overview still queries the table. It permanently deletes the 18
-- stored picks, so skip it if you want to keep them around. profiles.overview_seeded becomes unused
-- too; it is left in place (harmless).
--
--   drop table if exists user_overview_projects;
-- ---------------------------------------------------------------------------

-- Afterwards, to confirm (read-only):
--   select column_name, data_type, column_default from information_schema.columns
--     where table_name = 'profiles' and column_name = 'overview_view';
--   select pg_get_constraintdef(oid) from pg_constraint
--     where conrelid = 'public.tasks'::regclass and pg_get_constraintdef(oid) ilike '%source_category%';
--   select phase, name, sort_order from checklist_items where phase = 'closeout' and project_id is null order by sort_order;
