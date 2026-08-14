-- Weekly Search Console snapshots for the SEO measurement engine.
-- Written only by the seo-report cron (service role); never exposed to the
-- app's anon/authenticated clients, so RLS stays enabled with no policies.
create table if not exists public.seo_query_metrics (
  id bigint generated always as identity primary key,
  captured_on date not null,
  page text not null,
  query text not null,
  clicks integer not null default 0,
  impressions integer not null default 0,
  ctr numeric,
  position numeric,
  created_at timestamptz not null default now(),
  unique (captured_on, page, query)
);

alter table public.seo_query_metrics enable row level security;
