-- A page per unit (Wyatt, 2026-11-06).
--
-- A listing's monitor keeps one building-level page, which is where new units
-- show up. A unit can also have its own page (a small landlord's page per
-- apartment, a floor plan's page): the sync reads that page alone, with no
-- crawling, and trusts it over the building page for that unit. When a unit's
-- page is gone, the unit is treated as let and its leases are withdrawn (not
-- deleted).
--
-- One live page per unit. Soft-deleted rows stay for the history.

create table if not exists public.listing_unit_pages (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  unit_id uuid not null references public.listing_units(id) on delete cascade,
  url text not null,
  source_kind text not null default 'own_site' check (source_kind in ('own_site', 'portal')),
  added_by uuid references public.users(id) on delete set null,
  enabled boolean not null default true,
  -- ok: the page showed this unit; gone: the page is missing or no longer
  -- shows it (its leases were withdrawn); failed: could not be read this time.
  last_status text check (last_status in ('ok', 'gone', 'failed')),
  last_error text,
  last_checked_at timestamptz,
  last_seen_at timestamptz,
  consecutive_failures integer not null default 0,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists listing_unit_pages_one_live_per_unit
  on public.listing_unit_pages (unit_id) where deleted_at is null;
create index if not exists listing_unit_pages_listing
  on public.listing_unit_pages (listing_id) where deleted_at is null;

-- Server only, as with the other source tables.
alter table public.listing_unit_pages enable row level security;

drop trigger if exists trg_set_updated_at_listing_unit_pages on public.listing_unit_pages;
create trigger trg_set_updated_at_listing_unit_pages
  before update on public.listing_unit_pages
  for each row execute function public.fn_set_updated_at();
