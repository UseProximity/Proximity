-- Pages the URL importer fetched in the last few minutes, shared by every
-- building's read in a batch (and by the picker that preceded it), so a
-- 12-building import of one landlord's site fetches its home page, property
-- list and site-wide pages once instead of twelve times. Rows older than an
-- hour are cleared by the importer itself. Service role only. Apply to dev
-- and prod.
create table if not exists public.listing_import_page_cache (
  key text primary key,
  page jsonb not null,
  fetched_at timestamptz not null default now()
);
create index if not exists listing_import_page_cache_fetched_at_idx on public.listing_import_page_cache (fetched_at);
alter table public.listing_import_page_cache enable row level security;
comment on table public.listing_import_page_cache is
  'Short-lived cache of fetched landlord pages for lib/sourceImport (15 minute reads, cleared after an hour).';
