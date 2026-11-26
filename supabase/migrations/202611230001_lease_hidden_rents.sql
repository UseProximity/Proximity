/*
 * Hidden website prices (Wyatt, 2026-11-20).
 *
 * A lease with no public rent is the landlord's choice: students see "Contact
 * for Pricing". When the landlord's own website does show a price, the source
 * sync keeps it here instead of filling the public rent. Matchmaking (Find
 * Your Place) ranks with it and Proxy may give a rough range from it. Neither
 * ever shows the figure, and it is never written to unit_leases.rent.
 *
 * One row per lease. A row stops being used once seen_at is over 30 days old,
 * and is ignored whenever the lease has a public rent of its own.
 *
 * RLS on with NO policies, plus explicit revokes: service role only. The anon
 * key ships in the browser bundle, so this table must never be readable by
 * it, even by accident. No SECURITY DEFINER functions.
 *
 * Idempotent: safe to re-run. Not destructive: only creates objects.
 * Apply to dev first, verify, then prod.
 */

create table if not exists public.lease_hidden_rents (
  lease_id           uuid        primary key references public.unit_leases(id) on delete cascade,
  listing_id         uuid        not null references public.listings(id) on delete cascade,
  rent               numeric     not null,
  -- true = per person, false = whole unit, null = the website did not say.
  rent_is_per_person boolean,
  -- The page the price was read from. Admin only.
  source_url         text,
  -- Last time the website showed this price. Matchmaking ignores rows older
  -- than 30 days.
  seen_at            timestamptz not null default now(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint lease_hidden_rents_rent_positive check (rent > 0 and rent < 100000)
);

create index if not exists lease_hidden_rents_listing_idx on public.lease_hidden_rents (listing_id);

alter table public.lease_hidden_rents enable row level security;
revoke all on table public.lease_hidden_rents from public, anon, authenticated;
grant all on table public.lease_hidden_rents to service_role;
