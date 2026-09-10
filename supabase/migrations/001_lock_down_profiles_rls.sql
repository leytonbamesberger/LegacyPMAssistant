-- Run once in the Supabase SQL editor if you already applied the earlier
-- permissive POC policies. Removes browser (anon) access to these tables;
-- all writes now go through POST /api/profile with the service-role key.

drop policy if exists "poc anon read profiles" on profiles;
drop policy if exists "poc anon insert profiles" on profiles;

-- Also clear any policies left over from the Table Editor / earlier attempts.
drop policy if exists "poc anon can read profiles" on profiles;
drop policy if exists "poc anon can create profiles" on profiles;

alter table profiles enable row level security;
alter table procore_connections enable row level security;

-- Verify: this should return zero rows.
-- select * from pg_policies where tablename in ('profiles', 'procore_connections');
