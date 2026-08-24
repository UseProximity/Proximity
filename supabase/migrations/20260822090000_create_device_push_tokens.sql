-- Expo push tokens for the mobile app, one row per device. A user can have
-- multiple rows (multiple devices); tokens are unique across users since
-- Expo issues one token per physical device+app install.
--
-- Re-registering the same device under a different account reassigns it via
-- upsert. NOTE: that reassignment only works through the service-role client
-- (`@/lib/supabase`), which bypasses RLS. Under the user-scoped policies below
-- a second user cannot see or update the first user's row, so a direct
-- client-side upsert would hit uq_device_push_tokens_token and fail. Register
-- tokens through a server API route, not from the native client directly.
create table if not exists device_push_tokens (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references users(id) on delete cascade,
  expo_push_token text not null,
  platform        text not null check (platform in ('ios', 'android')),
  created_at      timestamptz not null default now(),
  last_seen_at    timestamptz not null default now()
);

create unique index if not exists uq_device_push_tokens_token
  on device_push_tokens (expo_push_token);
create index if not exists idx_device_push_tokens_user
  on device_push_tokens (user_id);

alter table device_push_tokens enable row level security;
drop policy if exists dpt_select on device_push_tokens;
drop policy if exists dpt_write  on device_push_tokens;
create policy dpt_select on device_push_tokens for select
  using (user_id = fn_current_user_id() or fn_current_user_role() = 'super');
-- WITH CHECK stated explicitly: it matches the USING expression (which Postgres
-- would infer anyway), so a user can only ever write rows owned by themselves.
create policy dpt_write  on device_push_tokens for all
  using (user_id = fn_current_user_id())
  with check (user_id = fn_current_user_id());
