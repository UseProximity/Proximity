-- Per-listing agents, milestone 6: every agent syncs daily (PRD v3). The
-- monitor interval used to default to weekly; the daily batch queues each
-- due listing as its own job, so a day is the new default and every
-- existing weekly monitor moves to it.
--
-- Idempotent. Apply to BOTH dev and prod.

alter table public.listing_source_monitors alter column check_interval_days set default 1;
update public.listing_source_monitors set check_interval_days = 1 where check_interval_days is null or check_interval_days = 7;
