-- Queue of listing changes worth push-notifying users who saved the listing.
-- Populated by a trigger on `listings`; a cron job (mirroring
-- api/cron/availability-check) drains unprocessed rows, joins
-- user_listing_interactions + device_push_tokens, sends the pushes, then
-- stamps processed_at.
--
-- JOIN SHAPE: user_listing_interactions has NO `interaction_type` text column.
-- It carries `interaction_type_id` -> interaction_types(id). Filter saves with
--   join interaction_types t on t.id = i.interaction_type_id and t.name = 'saved'
--
-- FIRST-RUN HAZARD: this trigger goes live the moment the migration runs, well
-- before any drain job exists, so rows accumulate immediately (api/cron/
-- auto-unavailable flips `unavailable` hourly). The first deploy of the drain
-- job MUST NOT blast that backlog at users -- stamp pre-existing rows as
-- processed, or floor the query at the drain job's own ship date.
--
-- THROTTLING is the drain job's responsibility, not this table's: `unavailable`
-- can flip true->false->true (auto-unavailable hides are undoable and
-- re-appliable), and a re-import can step min_rent down repeatedly. Dedupe per
-- (user, listing, event_type) over a sensible window before sending.
create table if not exists listing_notification_events (
  id           uuid primary key default gen_random_uuid(),
  listing_id   uuid not null references listings(id) on delete cascade,
  event_type   text not null check (event_type in ('price_drop', 'unavailable', 'deleted')),
  old_value    jsonb,
  new_value    jsonb,
  created_at   timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists idx_lne_unprocessed
  on listing_notification_events (created_at) where processed_at is null;
create index if not exists idx_lne_listing
  on listing_notification_events (listing_id);

-- Service-role access only (the app's server-side client bypasses RLS).
alter table listing_notification_events enable row level security;

create or replace function fn_queue_listing_notification_events()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.deleted_at is not null and old.deleted_at is null then
    insert into listing_notification_events (listing_id, event_type, old_value, new_value)
    values (new.id, 'deleted', null, null);
    return new;
  end if;

  if new.unavailable is true and coalesce(old.unavailable, false) is false then
    insert into listing_notification_events (listing_id, event_type, old_value, new_value)
    values (new.id, 'unavailable', to_jsonb(old.unavailable), to_jsonb(new.unavailable));
  end if;

  if new.min_rent is not null and old.min_rent is not null and new.min_rent < old.min_rent then
    insert into listing_notification_events (listing_id, event_type, old_value, new_value)
    values (new.id, 'price_drop', to_jsonb(old.min_rent), to_jsonb(new.min_rent));
  end if;

  return new;
end;
$$;

drop trigger if exists trg_queue_listing_notification_events on listings;
create trigger trg_queue_listing_notification_events
  after update on listings
  for each row
  execute function fn_queue_listing_notification_events();
