-- Run once in the Supabase SQL editor. Enforces one Procore connection per
-- profile so /api/procore/callback can upsert on profile_id.

-- Drop any duplicate rows first (keeps the most recently connected).
delete from procore_connections a
using procore_connections b
where a.profile_id = b.profile_id
  and a.connected_at < b.connected_at;

alter table procore_connections
  add constraint procore_connections_profile_id_key unique (profile_id);

-- The old plain index is now redundant with the unique constraint's index.
drop index if exists procore_connections_profile_id_idx;
