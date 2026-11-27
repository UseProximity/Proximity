-- Listing recipes (sync confidence ledger, stage 2): how code reads a site's
-- units with no model (lib/sourceImport/recipe.js). One active recipe per
-- listing, and one per platform so a second building on the same platform is
-- read by code from its first day. A replaced recipe is retired, never
-- deleted, so versions can be compared. Server only. Apply to dev and prod.
create table if not exists public.source_recipes (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('listing', 'platform')),
  listing_id uuid references public.listings(id) on delete cascade,
  platform_key text,
  version integer not null default 1,
  recipe jsonb not null,
  status text not null default 'active' check (status in ('active', 'retired')),
  made_from text,
  checked jsonb,
  uses integer not null default 0,
  failures integer not null default 0,
  last_ok_at timestamptz,
  created_at timestamptz not null default now(),
  retired_at timestamptz,
  constraint source_recipes_scope_target check (
    (scope = 'listing' and listing_id is not null) or (scope = 'platform' and platform_key is not null)
  )
);
create unique index if not exists uq_source_recipes_active_listing on public.source_recipes (listing_id) where status = 'active' and scope = 'listing';
create unique index if not exists uq_source_recipes_active_platform on public.source_recipes (platform_key) where status = 'active' and scope = 'platform';
create index if not exists idx_source_recipes_listing on public.source_recipes (listing_id, version desc);

alter table public.source_recipes enable row level security;
revoke all on public.source_recipes from anon, authenticated;
