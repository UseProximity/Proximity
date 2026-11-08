-- Website sync launch review (Wyatt, 2026-11-07).
--
-- source_attached: the sync found a listing's own page on a company-wide
-- website the landlord gave us (macapartments.com -> macapartments.com/euclid)
-- and made it that listing's source. Recorded so the team sees every one.
--
-- subpages_checked_at: when that search last ran for a monitor, so a
-- company page is searched about once a month rather than every day.

alter table public.listing_source_events drop constraint if exists listing_source_events_kind_check;
alter table public.listing_source_events add constraint listing_source_events_kind_check check (kind = any (array[
  'rent_change', 'unit_delisted', 'unit_relisted', 'availability_change', 'listing_gone', 'rent_divergence',
  'missing_unit', 'availability_divergence', 'spec_mismatch', 'lease_new', 'lease_withdrawn', 'lease_updated',
  'unit_new', 'unit_updated', 'property_updated', 'photos_added', 'churn_hold', 'fetch_failed', 'low_confidence',
  'source_attached'
]::text[]));

alter table public.listing_source_monitors add column if not exists subpages_checked_at timestamptz;
