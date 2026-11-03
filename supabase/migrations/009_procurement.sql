-- 009 — Procurement log
--
-- Run in the Supabase SQL Editor. Idempotent: safe to run more than once. Everything below is
-- additive — it changes no existing data and drops nothing.
--
--   1. procurement_items          one row per procured item (replaces the per-project Excel sheets)
--   2. tasks.procurement_item_id  links a task to an item; deleting an item NEVER deletes a task
--   3. profiles.procurement_view       the Procurement tab's "Choose a View" selection (jsonb), the
--                                      same shape as profiles.overview_view but independent of it
--   4. profiles.procurement_collapsed  project ids whose groups are collapsed in the log (jsonb array)
--
-- Est. Delivery and Status are computed in the app from the dates + lead time; they are not stored.
--
-- Access model: same as every other table here. Row Level Security is ENABLED with NO policies of our
-- own — the browser has no Supabase identity (Microsoft sign-in, not Supabase Auth), so no
-- `auth.jwt() ->> 'oid'` policy could ever match. All reads and writes go through /api/* with the
-- service-role key (which bypasses RLS) after the Microsoft ID token is verified, and any signed-in
-- user can read and write items, exactly as asked. The public anon key can neither read nor write.

begin;

-- ---------------------------------------------------------------------------
-- 1. procurement_items
-- ---------------------------------------------------------------------------
create table if not exists procurement_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  spec_number text,
  description text not null,
  tag text,
  submitted_date date,
  approved_date date,
  ordered_date date,
  delivered_date date,
  required_on_site date,
  lead_time_value integer check (lead_time_value >= 0),
  lead_time_unit text default 'weeks' check (lead_time_unit in ('days', 'weeks')),
  vendor text,
  vendor_rep text,
  delivery_location text,
  po_number text,
  notes text,
  sort_order integer default 0,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists procurement_items_project_id_idx on procurement_items (project_id);

-- Keep updated_at current on every UPDATE.
create or replace function procurement_items_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists procurement_items_touch_updated_at on procurement_items;
create trigger procurement_items_touch_updated_at
  before update on procurement_items
  for each row execute function procurement_items_touch_updated_at();

alter table procurement_items enable row level security;

-- ---------------------------------------------------------------------------
-- 2. tasks.procurement_item_id — ON DELETE SET NULL: removing an item only clears the link.
-- ---------------------------------------------------------------------------
alter table tasks
  add column if not exists procurement_item_id uuid references procurement_items(id) on delete set null;

create index if not exists tasks_procurement_item_id_idx on tasks (procurement_item_id);

-- ---------------------------------------------------------------------------
-- 3 + 4. Per-user Procurement tab state.
--    procurement_view      { "mine": bool, "pm_ids": [profile ids], "project_ids": [project ids] }
--                          (same meaning as overview_view; default = the user's Added projects, live)
--    procurement_collapsed [project ids] whose groups are collapsed
-- ---------------------------------------------------------------------------
alter table profiles
  add column if not exists procurement_view jsonb not null
  default '{"mine": true, "pm_ids": [], "project_ids": []}'::jsonb;

alter table profiles
  add column if not exists procurement_collapsed jsonb not null
  default '[]'::jsonb;

commit;

-- Afterwards, to confirm (read-only):
--   select column_name, data_type, is_nullable, column_default from information_schema.columns
--     where table_name = 'procurement_items' order by ordinal_position;
--   select column_name, data_type, column_default from information_schema.columns
--     where (table_name = 'tasks' and column_name = 'procurement_item_id')
--        or (table_name = 'profiles' and column_name in ('procurement_view', 'procurement_collapsed'));
--   select relrowsecurity from pg_class where relname = 'procurement_items';   -- true
