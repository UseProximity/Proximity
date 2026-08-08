-- PMS onboarding ledger: record what happens while a landlord is connecting,
-- not just what the nightly sync does afterwards.
--
-- Two CHECK constraints widen:
--
-- 1. pms_connections.status gains 'pending'. The connection row is now created
--    BEFORE the credential is verified, so a credential that fails has a row to
--    attach the reason to (previously the most likely failure in the whole flow
--    left no trace at all). 'pending' never syncs — the cron selects 'active' —
--    so an abandoned attempt is inert.
--
-- 2. pms_sync_events.result gains 'observed' for informational onboarding steps.
--    Failures keep using 'error'. Onboarding steps always carry applied = false;
--    nothing in that phase writes to a listing.

alter table public.pms_connections
  drop constraint if exists pms_connections_status_check;

alter table public.pms_connections
  add constraint pms_connections_status_check
  check (status = any (array['pending'::text, 'active'::text, 'error'::text, 'disconnected'::text]));

alter table public.pms_sync_events
  drop constraint if exists pms_sync_events_result_check;

alter table public.pms_sync_events
  add constraint pms_sync_events_result_check
  check (result = any (array[
    'created'::text, 'updated'::text, 'delisted'::text, 'relisted'::text,
    'flagged'::text, 'held'::text, 'skipped'::text, 'error'::text,
    'observed'::text
  ]));

-- Reading one landlord's onboarding trail means "every event for this
-- connection, oldest first" — the ordering the report email and any follow-up
-- investigation both use.
create index if not exists idx_pms_sync_events_connection_created
  on public.pms_sync_events (connection_id, created_at);
