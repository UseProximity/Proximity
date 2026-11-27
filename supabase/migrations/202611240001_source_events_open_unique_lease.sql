-- The open-event key left out the lease: two leases of one floor plan given
-- the same held change (two withdrawals, the same new date) broke the insert,
-- and every row after the first was dropped. recordEvents already tells them
-- apart by lease (lib/sourceImport/apply.js); the index now does too.
-- Apply to dev and prod.
drop index if exists public.uq_listing_source_events_open;
create unique index uq_listing_source_events_open
  on public.listing_source_events (
    monitor_id, kind, coalesce(unit_key, ''), coalesce(detail->>'leaseId', ''),
    coalesce(field, ''), md5(coalesce(new_value::text, ''))
  )
  where status = 'open';
