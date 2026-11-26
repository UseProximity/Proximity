-- Background import jobs for the paste-your-website importer, and a wider
-- vocabulary for the source-sync event log.
--
-- The picker's Continue creates one draft listing per ticked property and one
-- job per draft. A runner reads the website in the background and writes the
-- result onto the draft; the workspace polls these rows for progress. The same
-- reader and writer serve the weekly source sync, which logs what it changed
-- (or refused to change) in listing_source_events, so that table's kind check
-- is widened to name the decisions the writer makes.
--
-- Apply to BOTH dev and prod.

create table if not exists public.listing_import_jobs (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null,
  user_id uuid not null references public.users(id) on delete cascade,
  listing_id uuid references public.listings(id) on delete set null,
  -- What the picker handed us: { name, address, url, levelUrl, pastedUrl,
  -- alreadyListed }. url is the property's own page when the site has one.
  target jsonb not null default '{}'::jsonb,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'done', 'failed', 'cancelled')),
  -- A short, landlord-readable line: "Reading floor plans", "Saving photos".
  step text,
  progress integer not null default 0,
  attempts integer not null default 0,
  error text,
  -- Summary of what the read produced: counts, notes for the landlord, and
  -- the snapshot that was applied. Small; the snapshot itself is capped.
  result jsonb,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists listing_import_jobs_batch_idx
  on public.listing_import_jobs (batch_id, created_at);
create index if not exists listing_import_jobs_status_idx
  on public.listing_import_jobs (status, created_at);
create index if not exists listing_import_jobs_user_idx
  on public.listing_import_jobs (user_id, created_at desc);

alter table public.listing_import_jobs enable row level security;
-- Service role only, like the other source-sync tables. The API routes check
-- ownership themselves.

-- The writer's decisions, by name. The original vocabulary covered a monitor
-- that only observed; the writer now applies some changes and holds others.
alter table public.listing_source_events
  drop constraint if exists listing_source_events_kind_check;
alter table public.listing_source_events
  add constraint listing_source_events_kind_check check (kind in (
    'rent_change', 'unit_delisted', 'unit_relisted', 'availability_change',
    'listing_gone', 'rent_divergence', 'missing_unit', 'availability_divergence',
    'spec_mismatch',
    -- added 2026-10-20
    'lease_new', 'lease_withdrawn', 'lease_updated', 'unit_new', 'unit_updated',
    'property_updated', 'photos_added', 'churn_hold', 'fetch_failed', 'low_confidence'
  ));

comment on table public.listing_import_jobs is
  'One background read of a landlord website per ticked property. Created by POST /api/landlord/import/start, run by lib/sourceImport/jobs.js, polled by the import workspace.';
