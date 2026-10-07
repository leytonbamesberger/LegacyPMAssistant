-- 007 — give open manual tasks without a due date one
--
-- A due date is now required on manual tasks (Add / Edit Task), and the Tasks page's default window
-- (late + next 7 days) hides tasks with no date, so older manual tasks saved without one dropped out
-- of sight. This stamps them with today's date in Mountain time so they show up again.
--
-- Manual = source_category is null (checklist / generated tasks are untouched). Completed tasks are
-- left alone. Idempotent: once a row has a date it no longer matches, so re-running changes nothing.

begin;

update tasks
   set due_date = (now() at time zone 'America/Denver')::date
 where due_date is null
   and source_category is null
   and status <> 'complete';

commit;

-- To preview before running (read-only):
--   select id, title, status, created_at from tasks
--    where due_date is null and source_category is null and status <> 'complete';
