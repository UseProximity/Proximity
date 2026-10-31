-- Per-listing agents, milestone 1: the knowledge store (Wyatt, PRD v3, 2026-10-26).
--
-- Every listing gets an agent: a store of facts about the building, each with
-- its own source, plus the Proxy chatbot (later milestones) that answers
-- students from those facts. An agent is not a process: it is these rows plus
-- shared code, so one per listing costs nothing to keep.
--
--   listing_agents        one row per listing. status is the per-listing switch
--                         ('off' until the pilot; 'pilot' and 'on' both mean
--                         Proxy answers). Sync bookkeeping fills in later.
--   listing_sources       where facts come from: the listing's own data on
--                         Proximity ('site_data'), a page the agent reads, an
--                         uploaded document, something the landlord told the
--                         agent, a landlord's answer to a student question,
--                         PMS, admin curation, or old chat history (backfill).
--                         Page sources carry the sync schedule and backoff
--                         that listing_source_monitors carried before.
--   listing_facts         one row per claim: section (core, fees, policies,
--                         specials, misc), field key, structured value, a
--                         one-line student-safe summary, scope (property,
--                         one owner's offer, a unit type, or a lease), source,
--                         redacted excerpt, confidence, validity window, and
--                         whether the landlord set it. Only one row per key
--                         and scope is current; the rest are history.
--                         Core values (rent, beds, availability) are NOT
--                         copied here. They stay in listings, listing_units and
--                         unit_leases and are read live. A core row records
--                         only where a core value came from, and only when a
--                         specific source set it; no row means site data.
--   listing_fact_events   the change log and the review queue: what changed,
--                         why (seed, sync, URL added, landlord chat or answer,
--                         dashboard, admin, document, backfill, revert) and
--                         whether it was applied, held for the landlord,
--                         proposed, approved, rejected or reverted.
--   listing_documents     uploaded files: metadata and the redacted excerpt
--                         kept after extraction. The file itself is deleted.
--   listing_agent_usage   model spend per agent, summed against the caps.
--
-- listing_field_states (never used) is dropped: listing_facts replaces it.
-- listing_concessions.listing_lease_id pointed at the retired listing_leases
-- table; it now points at unit_leases.
--
-- Service role only, like the source tables. Idempotent. Apply to BOTH dev
-- and prod.

create table if not exists public.listing_agents (
  listing_id uuid primary key references public.listings(id) on delete cascade,
  status text not null default 'off' check (status in ('off', 'pilot', 'on')),
  seeded_at timestamptz,
  last_sync_at timestamptz,
  last_manual_sync_at timestamptz,
  manual_syncs_today integer not null default 0,
  manual_sync_day date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.listing_agents enable row level security;
create index if not exists listing_agents_status_idx on public.listing_agents (status);

create table if not exists public.listing_sources (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  kind text not null check (kind in (
    'site_data', 'page', 'document', 'landlord_statement', 'landlord_answer',
    'pms', 'admin', 'chat_backfill'
  )),
  -- What the source is, by kind: the page URL, the document, the message or
  -- question the landlord answered, or the user behind a statement or edit.
  url text,
  document_id uuid,
  message_id uuid references public.chat_messages(id) on delete set null,
  question_id uuid,
  user_id uuid references public.users(id) on delete set null,
  -- The owner whose offer this source speaks for. NULL = the property itself
  -- (the primary owner's word, site data, admin).
  owner_id uuid references public.users(id) on delete set null,
  label text,
  enabled boolean not null default true,
  -- Sync schedule and backoff, for page sources (milestone 6).
  check_interval_days integer,
  next_check_at timestamptz,
  last_checked_at timestamptz,
  last_status text check (last_status in (
    'ok', 'unchanged', 'changed', 'fetch_failed', 'parse_failed', 'gone', 'stale'
  )),
  last_error text,
  consecutive_failures integer not null default 0,
  last_fingerprint text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.listing_sources enable row level security;
create index if not exists listing_sources_listing_idx on public.listing_sources (listing_id, kind);
create index if not exists listing_sources_due_idx
  on public.listing_sources (next_check_at) where kind = 'page' and enabled;
-- One site-data source per listing, and one page source per URL per listing.
create unique index if not exists listing_sources_site_data_uq
  on public.listing_sources (listing_id) where kind = 'site_data';
create unique index if not exists listing_sources_page_url_uq
  on public.listing_sources (listing_id, url) where kind = 'page';

create table if not exists public.listing_facts (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  section text not null check (section in ('core', 'fees', 'policies', 'specials', 'misc')),
  -- Dotted key inside the section: fee.application, policy.pets,
  -- special.<slug>, misc.laundry, core.rent. lib/agents/sections.js lists
  -- the known ones; misc and specials take free slugs.
  field_key text not null,
  value jsonb not null default '{}'::jsonb,
  -- One line a student may be shown, with no source names or URLs in it.
  summary text not null,
  scope_level text not null default 'property'
    check (scope_level in ('property', 'owner', 'unit', 'lease')),
  -- owner: users.id; unit: listing_units.id; lease: unit_leases.id.
  scope_id uuid,
  source_id uuid references public.listing_sources(id) on delete set null,
  -- The exact thing the fact was read from, kept even if the source row goes:
  -- a page URL, a document id or a message id.
  source_ref text,
  excerpt text,
  confidence text not null default 'high' check (confidence in ('high', 'medium', 'low')),
  -- True when a landlord (or an admin, after launch) set or answered it.
  -- Landlord-set facts outrank every other source and are never overwritten
  -- by a sync; the sync holds the change for the landlord instead.
  landlord_set boolean not null default false,
  set_by uuid references public.users(id) on delete set null,
  observed_at timestamptz not null default now(),
  valid_from date,
  valid_until date,
  is_current boolean not null default true,
  superseded_by uuid references public.listing_facts(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.listing_facts enable row level security;
create index if not exists listing_facts_listing_current_idx
  on public.listing_facts (listing_id, section) where is_current;
create index if not exists listing_facts_source_idx on public.listing_facts (source_id);
-- One current fact per key and scope. scope_id is folded to the nil uuid so
-- property-level rows (NULL scope_id) take part in the uniqueness too.
create unique index if not exists listing_facts_current_uq
  on public.listing_facts (
    listing_id, section, field_key, scope_level,
    coalesce(scope_id, '00000000-0000-0000-0000-000000000000'::uuid)
  ) where is_current;

create table if not exists public.listing_fact_events (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  fact_id uuid references public.listing_facts(id) on delete set null,
  previous_fact_id uuid references public.listing_facts(id) on delete set null,
  section text,
  field_key text,
  scope_level text,
  scope_id uuid,
  cause text not null check (cause in (
    'seed', 'sync', 'url_added', 'landlord_chat', 'landlord_answer',
    'dashboard', 'admin', 'document', 'backfill', 'revert'
  )),
  status text not null default 'applied' check (status in (
    'applied', 'held', 'proposed', 'approved', 'rejected', 'reverted'
  )),
  old_value jsonb,
  new_value jsonb,
  actor_id uuid references public.users(id) on delete set null,
  source_id uuid references public.listing_sources(id) on delete set null,
  detail jsonb not null default '{}'::jsonb,
  decided_by uuid references public.users(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.listing_fact_events enable row level security;
create index if not exists listing_fact_events_listing_idx
  on public.listing_fact_events (listing_id, created_at desc);
create index if not exists listing_fact_events_open_idx
  on public.listing_fact_events (listing_id, created_at desc)
  where status in ('held', 'proposed');

create table if not exists public.listing_documents (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  uploaded_by uuid references public.users(id) on delete set null,
  filename text,
  mime_type text,
  size_bytes integer,
  -- Where the file sits while it is being read. Cleared once it is deleted.
  storage_key text,
  status text not null default 'uploaded' check (status in (
    'uploaded', 'extracting', 'done', 'rejected', 'failed'
  )),
  reject_reason text,
  excerpt text,
  facts_count integer not null default 0,
  error text,
  extracted_at timestamptz,
  file_deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.listing_documents enable row level security;
create index if not exists listing_documents_listing_idx
  on public.listing_documents (listing_id, created_at desc);

-- The document behind a 'document' source, now that the table exists.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'listing_sources_document_id_fkey'
  ) then
    alter table public.listing_sources
      add constraint listing_sources_document_id_fkey
      foreign key (document_id) references public.listing_documents(id) on delete set null;
  end if;
end $$;

create table if not exists public.listing_agent_usage (
  id bigserial primary key,
  listing_id uuid references public.listings(id) on delete cascade,
  kind text not null,
  model text,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cost_cents numeric(10, 4) not null default 0,
  created_at timestamptz not null default now()
);
alter table public.listing_agent_usage enable row level security;
create index if not exists listing_agent_usage_listing_at_idx
  on public.listing_agent_usage (listing_id, created_at);
create index if not exists listing_agent_usage_at_idx
  on public.listing_agent_usage (created_at);

-- updated_at upkeep, with the trigger function the rest of the schema uses.
do $$
declare t text;
begin
  foreach t in array array['listing_agents', 'listing_sources', 'listing_facts', 'listing_fact_events', 'listing_documents']
  loop
    if not exists (
      select 1 from pg_trigger
      where tgname = 'trg_set_updated_at_' || t and tgrelid = ('public.' || t)::regclass
    ) then
      execute format(
        'create trigger trg_set_updated_at_%I before update on public.%I for each row execute function fn_set_updated_at()',
        t, t
      );
    end if;
  end loop;
end $$;

-- Specials and fees pointed at the retired listing_leases table. Every row has
-- NULL there today; repoint them at unit_leases so a fact can scope to a lease.
do $$
declare t text;
begin
  foreach t in array array['listing_concessions', 'listing_fees']
  loop
    if exists (
      select 1 from pg_constraint c
      join pg_class r on r.oid = c.confrelid
      where c.conname = t || '_listing_lease_id_fkey' and r.relname = 'listing_leases'
    ) then
      execute format('alter table public.%I drop constraint %I', t, t || '_listing_lease_id_fkey');
      execute format(
        'alter table public.%I add constraint %I foreign key (listing_lease_id) references public.unit_leases(id) on delete set null',
        t, t || '_listing_lease_id_fkey'
      );
    end if;
  end loop;
end $$;

-- Never written or read by any code; listing_facts takes its job.
drop table if exists public.listing_field_states;
