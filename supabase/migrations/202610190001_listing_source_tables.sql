-- The source-sync tables and listing source columns, as they already exist on
-- dev and prod. They were created straight in the database (Sept 2026) with no
-- migration in the repo, so a fresh database could not run the importer and
-- the later migrations (202610200001, 202610210001, 202610240003) altered
-- tables nothing created. Every statement is idempotent: on dev and prod this
-- changes nothing; on a new database it builds the tables those migrations
-- expect. Definitions copied from the live dev schema on 2026-10-26.
--
-- Apply to BOTH dev and prod (a no-op on both today).

-- Where a listing was imported from. own_site = the landlord's website,
-- portal = a third-party listing site (lib/sourceSync/classify.js).
alter table public.listings add column if not exists source_url text;
alter table public.listings add column if not exists source_kind text;
alter table public.listings add column if not exists source_added_at timestamptz;
alter table public.listings add column if not exists source_added_by uuid;

-- One monitor per listing: the page the sync re-reads and how that went.
create table if not exists public.listing_source_monitors (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null unique references public.listings(id) on delete cascade,
  source_url text not null,
  source_kind text not null check (source_kind in ('own_site', 'portal')),
  enabled boolean not null default true,
  auto_apply boolean not null default false,
  last_checked_at timestamptz,
  last_status text check (last_status in (
    'ok', 'unchanged', 'changed', 'fetch_failed', 'parse_failed',
    'suppressed', 'skipped', 'gone', 'url_stale'
  )),
  last_error text,
  consecutive_failures integer not null default 0,
  muted_until timestamptz,
  last_fingerprint text,
  last_extracted_at timestamptz,
  check_interval_days integer not null default 7,
  next_check_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  index_url text
);
create index if not exists idx_listing_source_monitors_due
  on public.listing_source_monitors (next_check_at nulls first) where enabled;

-- What each read found, kept for comparison and debugging.
create table if not exists public.listing_source_snapshots (
  id uuid primary key default gen_random_uuid(),
  monitor_id uuid not null references public.listing_source_monitors(id) on delete cascade,
  fetched_at timestamptz not null default now(),
  ok boolean not null,
  normalized jsonb,
  rollup jsonb,
  unit_count integer,
  error text
);
create index if not exists idx_listing_source_snapshots_monitor
  on public.listing_source_snapshots (monitor_id, fetched_at desc);

-- Every change the sync applied or held for a person. The kind check is
-- widened by 202610200001 and the open-event index rebuilt by 202610240003.
create table if not exists public.listing_source_events (
  id uuid primary key default gen_random_uuid(),
  monitor_id uuid not null references public.listing_source_monitors(id) on delete cascade,
  listing_id uuid not null references public.listings(id) on delete cascade,
  kind text not null,
  unit_key text,
  field text,
  old_value jsonb,
  new_value jsonb,
  confidence text check (confidence in ('high', 'low')),
  status text not null default 'open' check (status in ('open', 'applied', 'rejected', 'muted')),
  applied boolean not null default false,
  verdict text check (verdict in ('accepted', 'rejected')),
  verdict_by uuid references public.users(id) on delete set null,
  verdict_at timestamptz,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'listing_source_events_kind_check'
      and conrelid = 'public.listing_source_events'::regclass
  ) then
    alter table public.listing_source_events
      add constraint listing_source_events_kind_check check (kind in (
        'rent_change', 'unit_delisted', 'unit_relisted', 'availability_change',
        'listing_gone', 'rent_divergence', 'missing_unit', 'availability_divergence',
        'spec_mismatch'
      ));
  end if;
end $$;
create index if not exists idx_listing_source_events_listing
  on public.listing_source_events (listing_id, created_at desc);
create index if not exists idx_listing_source_events_open
  on public.listing_source_events (created_at desc) where status = 'open';
create index if not exists idx_listing_source_events_open_by_listing
  on public.listing_source_events (listing_id, kind, unit_key) where status = 'open';
create unique index if not exists uq_listing_source_events_open
  on public.listing_source_events (monitor_id, kind, coalesce(unit_key, ''), coalesce(field, ''))
  where status = 'open';

-- Move-in specials. Hand-curated since Oct 2026; the importer writes them too.
-- listing_lease_id still points at the retired listing_leases table.
create table if not exists public.listing_concessions (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  listing_lease_id uuid references public.listing_leases(id) on delete cascade,
  description text not null,
  amount numeric,
  amount_type text check (amount_type in ('flat', 'percentage', 'months_free')),
  conditions text,
  valid_from date,
  valid_until date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_verified_at timestamptz,
  last_verified_source text
);
create index if not exists idx_listing_concessions_listing
  on public.listing_concessions (listing_id);
create index if not exists idx_listing_concessions_lease
  on public.listing_concessions (listing_lease_id) where listing_lease_id is not null;

-- Service role only for the source tables (the API routes check ownership).
-- Concessions keep the read policy they were created with.
alter table public.listing_source_monitors enable row level security;
alter table public.listing_source_snapshots enable row level security;
alter table public.listing_source_events enable row level security;
alter table public.listing_concessions enable row level security;
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'listing_concessions'
      and policyname = 'p_listing_concessions_read'
  ) then
    create policy p_listing_concessions_read on public.listing_concessions
      for select using (active = true and (valid_until is null or valid_until > now()));
  end if;
end $$;

-- updated_at and the audit trail, as on the live tables.
drop trigger if exists trg_set_updated_at_listing_source_monitors on public.listing_source_monitors;
create trigger trg_set_updated_at_listing_source_monitors
  before update on public.listing_source_monitors
  for each row execute function public.fn_set_updated_at();
drop trigger if exists trg_set_updated_at_listing_source_events on public.listing_source_events;
create trigger trg_set_updated_at_listing_source_events
  before update on public.listing_source_events
  for each row execute function public.fn_set_updated_at();
drop trigger if exists trg_listing_concessions_updated_at on public.listing_concessions;
create trigger trg_listing_concessions_updated_at
  before update on public.listing_concessions
  for each row execute function public.set_updated_at();
drop trigger if exists trg_action_log_listing_source_monitors on public.listing_source_monitors;
create trigger trg_action_log_listing_source_monitors
  after insert or update or delete on public.listing_source_monitors
  for each row execute function public.fn_action_log();
drop trigger if exists trg_action_log_listing_source_events on public.listing_source_events;
create trigger trg_action_log_listing_source_events
  after insert or update or delete on public.listing_source_events
  for each row execute function public.fn_action_log();
