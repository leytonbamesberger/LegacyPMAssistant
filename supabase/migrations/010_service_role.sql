-- 010 — Service role (service department salespeople)
--
-- Run in the Supabase SQL Editor. Idempotent: safe to run more than once. Everything below is
-- additive — it changes no existing data and drops nothing but the old (narrower) CHECKs it replaces.
--
--   1. profiles.title          now also allows 'service'  (pm | apm | service)
--   2. projects.service_id     the project's service salesman (nullable; at most one per project)
--   3. tasks.source_category   now also allows 'service'  (the "Meet with owner/client" task)
--
-- Access model: same as every other table. RLS is enabled with no policies of our own; all reads and
-- writes go through /api/* with the service-role key, so the new column needs no policy.
--
-- Live state when this was written (from supabase/schema.sql, not re-inspected): profiles.title is
-- text with a CHECK (title in ('pm','apm')); tasks.source_category is text with a CHECK that lists
-- setup / recurring / closeout. Neither is a Postgres enum, but step 1 handles an enum too in case
-- the live database differs.

begin;

-- ---------------------------------------------------------------------------
-- 1. profiles.title: 'pm' | 'apm' | 'service'
--    A text column with a CHECK means "adding a value" = replacing the check. Any check on title that
--    doesn't already list 'service' is dropped and the full one added; if one already lists it, nothing
--    happens. If the column turns out to be a Postgres enum instead, the value is added to the type.
--    Existing rows keep their title (null stays null: ensureProfile never sets a default).
-- ---------------------------------------------------------------------------
do $$
declare
  c record;
  col_type text;
  has_current boolean := false;
begin
  select data_type || ':' || udt_name
    into col_type
  from information_schema.columns
  where table_schema = 'public' and table_name = 'profiles' and column_name = 'title';

  if col_type like 'USER-DEFINED:%' then
    execute format('alter type %I add value if not exists %L', split_part(col_type, ':', 2), 'service');
  else
    for c in
      select conname, pg_get_constraintdef(oid) as def
      from pg_constraint
      where conrelid = 'public.profiles'::regclass
        and contype = 'c'
        and pg_get_constraintdef(oid) ilike '%title%'
    loop
      if c.def ilike '%service%' then
        has_current := true;
      else
        execute format('alter table public.profiles drop constraint %I', c.conname);
      end if;
    end loop;
    if not has_current then
      alter table public.profiles
        add constraint profiles_title_check
        check (title in ('pm', 'apm', 'service'));
    end if;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. projects.service_id — the service salesman. The index serves "projects with no salesman" and the
--    conditional claim (update ... where service_id is null) that stops two people claiming at once.
-- ---------------------------------------------------------------------------
alter table projects
  add column if not exists service_id uuid references profiles(id);

create index if not exists projects_service_id_idx on projects (service_id);

-- ---------------------------------------------------------------------------
-- 3. tasks.source_category: 'setup' | 'recurring' | 'closeout' | 'service'
--    Same approach as 008's 'closeout': any check on source_category that doesn't already list
--    'service' is dropped and the full one added.
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
    if c.def ilike '%service%' then
      has_current := true;
    else
      execute format('alter table public.tasks drop constraint %I', c.conname);
    end if;
  end loop;
  if not has_current then
    alter table public.tasks
      add constraint tasks_source_category_check
      check (source_category in ('setup', 'recurring', 'closeout', 'service'));
  end if;
end $$;

commit;

-- Afterwards, to confirm (read-only):
--   select pg_get_constraintdef(oid) from pg_constraint
--     where conrelid = 'public.profiles'::regclass and pg_get_constraintdef(oid) ilike '%title%';
--   select column_name, data_type, is_nullable from information_schema.columns
--     where table_name = 'projects' and column_name = 'service_id';   -- uuid, YES
--   select pg_get_constraintdef(oid) from pg_constraint
--     where conrelid = 'public.tasks'::regclass and pg_get_constraintdef(oid) ilike '%source_category%';
