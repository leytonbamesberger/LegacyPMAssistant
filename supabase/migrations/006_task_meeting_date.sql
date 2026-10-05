-- 006 — tasks.meeting_date
--
-- Meeting Setup tasks (checklist_items.is_meeting = true) now have two dates: due_date is the
-- project's "Setup complete by" date like every other setup task, and meeting_date is the date the
-- meeting is (or was) held. Entering a meeting date completes the task; the calendar shows the task
-- on its meeting_date.
--
-- Idempotent: safe to run more than once. Adds one nullable column; touches no data. Existing
-- meeting tasks keep their current values (meeting_date stays null until a date is entered).

begin;

alter table tasks add column if not exists meeting_date date;

commit;

-- Afterwards, to confirm (read-only):
--   select column_name, data_type, is_nullable from information_schema.columns
--     where table_name = 'tasks' and column_name = 'meeting_date';   -- date, YES
