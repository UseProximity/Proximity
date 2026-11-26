-- Sources of truth found for each listing (Wyatt, 2026-10-31): before the
-- agents launch, every listing is searched for the pages that describe it
-- elsewhere, so later work can keep it up to date from several references
-- and settle conflicts between them.
--
-- Retrieval only. Nothing here is read, synced or shown to students; a found
-- page becomes a listing_sources row only when that later work promotes it.
--
--   site        zillow, apartments_com, own_site (the property's own site or
--               its listing on the landlord's site), company_site (the
--               management company's home, from the contact email's domain)
--   page_type   building (the property's page), unit (one apartment's page),
--               home (a site's front page)
--   status      confirmed (exact address match), needs_review (a likely
--               match the team accepts or rejects), rejected
--   evidence    why it matched: the address or name seen, and where

create table if not exists public.listing_found_sources (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  url text not null,
  site text not null check (site in ('zillow', 'apartments_com', 'own_site', 'company_site')),
  page_type text not null default 'building' check (page_type in ('building', 'unit', 'home')),
  status text not null check (status in ('confirmed', 'needs_review', 'rejected')),
  confidence numeric(3, 2),
  title text,
  evidence text,
  found_by text,
  reviewed_by uuid references public.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (listing_id, url)
);
alter table public.listing_found_sources enable row level security;
create index if not exists listing_found_sources_status_idx
  on public.listing_found_sources (status, site);

-- When each listing was last searched, so a run can resume where it stopped
-- and a re-run only covers listings not searched yet.
alter table public.listing_agents
  add column if not exists sources_searched_at timestamptz;
