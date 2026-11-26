-- Per-listing agents, milestone 7: when an owner claimed a listing, for the
-- 14-day hold on their agent edits (PRD v3, "Ownership and permissions").
-- Every owner at launch starts verified: the backfill dates them to when the
-- row was created, which is older than 14 days for everyone who matters.
--
-- Idempotent. Apply to BOTH dev and prod.

alter table public.listing_landlords add column if not exists claimed_at timestamptz;
-- Everyone who is here at launch is verified, however recent their row.
update public.listing_landlords set claimed_at = least(created_at, now() - interval '15 days') where claimed_at is null;
alter table public.listing_landlords alter column claimed_at set default now();
