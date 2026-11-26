-- What each account has spent on the URL importer: one row per picker read
-- ("picker") and per building read or retried ("building", units = how
-- many). lib/sourceImport/limits.js sums these against per-account and
-- site-wide caps before any paid scrape runs, so a script or a crop of new
-- accounts cannot run up Firecrawl and Anthropic bills. Service role only.
-- Apply to dev and prod.
create table if not exists public.listing_import_usage (
  id bigserial primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  kind text not null check (kind in ('picker', 'building')),
  units integer not null default 1 check (units > 0),
  created_at timestamptz not null default now()
);
create index if not exists listing_import_usage_user_kind_at_idx on public.listing_import_usage (user_id, kind, created_at);
create index if not exists listing_import_usage_kind_at_idx on public.listing_import_usage (kind, created_at);
alter table public.listing_import_usage enable row level security;
comment on table public.listing_import_usage is
  'URL importer spend per account (picker reads, buildings read) for the caps in lib/sourceImport/limits.js.';
