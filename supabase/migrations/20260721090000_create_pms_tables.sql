-- PMS freshness integration — schema (PR1).
-- Landlords connect their property-management system (Buildium/AppFolio/DoorLoop/…)
-- through Nango's hosted auth; we store only a nango_connection_id reference token,
-- never raw PMS credentials. The PMS is the source of truth: each sync is a full
-- snapshot keyed by permanent PMS IDs (pms_links); omitted units delist, new units
-- ingest, with a ±20% swing guard held for review.

-- ============================================================
-- 1. pms_connections — one row per landlord × provider
-- ============================================================
create table if not exists pms_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  provider text not null check (provider in
    ('buildium','appfolio','doorloop','rentmanager','resman','scrape','aggregator')),
  nango_connection_id text,          -- reference token only; the secret lives in Nango
  status text not null default 'active' check (status in ('active','error','disconnected')),
  credential_meta jsonb not null default '{}'::jsonb,  -- non-secret label/plan; scrape stores its property URL here
  radius_auto_include_km numeric not null default 8,
  sync_price boolean not null default true,
  auto_apply boolean not null default true,            -- forced false for scrape connections
  last_sync_at timestamptz,
  last_sync_status text,             -- 'ok' | 'error' | 'held'
  last_sync_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create unique index if not exists uq_pms_connections_user_provider
  on pms_connections (user_id, provider)
  where deleted_at is null;

-- ============================================================
-- 2. listings — PMS columns (last_verified_* / paused_at / demoted_at already exist)
-- ============================================================
alter table listings
  add column if not exists pms_connection_id uuid references pms_connections(id) on delete set null,
  add column if not exists pms_stale_flagged_at timestamptz;

create index if not exists idx_listings_pms_connection
  on listings (pms_connection_id)
  where pms_connection_id is not null;

-- ============================================================
-- 3. pms_links — canonical PMS-ID ↔ Proximity mapping
-- ============================================================
create table if not exists pms_links (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references pms_connections(id) on delete cascade,
  external_property_id text not null,
  external_unit_id text,
  external_bed_id text,              -- by-the-bed student housing
  external_label text,               -- human-readable "Property — Unit 4B"
  listing_id uuid references listings(id) on delete set null,
  listing_unit_id uuid references listing_units(id) on delete set null,
  include boolean not null default true,
  origin text not null default 'ingested' check (origin in ('ingested','linked')),
  link_status text not null default 'pending' check (link_status in ('pending','confirmed','rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_pms_links_external
  on pms_links (connection_id, external_property_id,
                coalesce(external_unit_id, ''), coalesce(external_bed_id, ''));

create index if not exists idx_pms_links_listing on pms_links (listing_id);

-- ============================================================
-- 4. pms_sync_events — append-only sync audit trail
-- ============================================================
create table if not exists pms_sync_events (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references pms_connections(id) on delete cascade,
  pms_link_id uuid references pms_links(id) on delete set null,
  listing_id uuid,
  external_unit_id text,
  observed_available boolean,
  observed_rent numeric,
  applied boolean not null default false,
  result text not null check (result in
    ('created','updated','delisted','relisted','flagged','held','skipped','error')),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_pms_sync_events_connection
  on pms_sync_events (connection_id, created_at desc);

-- ============================================================
-- 5. pms_review_queue — scrape flags + swing-guard holds
-- ============================================================
create table if not exists pms_review_queue (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references pms_connections(id) on delete cascade,
  pms_link_id uuid references pms_links(id) on delete cascade,
  listing_id uuid references listings(id) on delete cascade,
  reason text not null check (reason in
    ('scrape_unavailable','swing_guard_hold','ambiguous_dedupe')),
  status text not null default 'open' check (status in
    ('open','resolved_hidden','resolved_kept','dismissed','approved')),
  detail jsonb not null default '{}'::jsonb,
  landlord_notified_at timestamptz,
  resolved_by uuid references users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_pms_review_open_link
  on pms_review_queue (pms_link_id)
  where status = 'open' and pms_link_id is not null;

create index if not exists idx_pms_review_status on pms_review_queue (status, created_at desc);

-- ============================================================
-- 6. updated_at + action_log triggers (existing conventions)
-- ============================================================
do $$
declare
  tbl text;
begin
  foreach tbl in array array['pms_connections','pms_links','pms_review_queue'] loop
    execute format(
      'drop trigger if exists trg_set_updated_at_%1$s on %1$I;
       create trigger trg_set_updated_at_%1$s
         before update on %1$I
         for each row execute function fn_set_updated_at();
       drop trigger if exists trg_action_log_%1$s on %1$I;
       create trigger trg_action_log_%1$s
         after insert or update or delete on %1$I
         for each row execute function fn_action_log();',
      tbl
    );
  end loop;
end $$;

-- ============================================================
-- 7. RPCs — audit-safe writes (attribute to the calling actor via app.current_user_id)
-- ============================================================

-- Apply a sync result to one listing in a single transaction:
--   p_listing_updates: scalar listings columns (e.g. {"unavailable": true, "pms_stale_flagged_at": null})
--   p_unit_updates:    [{"id": "<listing_unit_id>", "available": true}, ...]
--   p_lease_updates:   [{"unit_id": "<listing_unit_id>", "rent": 950, "available_from": "2026-08-01"}, ...]
create or replace function rpc_pms_apply(
  p_user_id         uuid,
  p_listing_id      uuid,
  p_listing_updates jsonb default null,
  p_unit_updates    jsonb default null,
  p_lease_updates   jsonb default null
) returns jsonb
language plpgsql security definer as $$
declare
  v_cols    text;
  v_sel     text;
  v_sql     text;
  v_item    jsonb;
  v_unit_id uuid;
  v_rent    numeric;
  v_avail   date;
  v_units_touched  int := 0;
  v_leases_touched int := 0;
begin
  perform set_config('app.current_user_id', p_user_id::text, true);

  if p_listing_updates is not null and p_listing_updates <> '{}'::jsonb then
    v_cols := (select string_agg(quote_ident(k), ', ') from jsonb_object_keys(p_listing_updates) k);
    v_sel  := (select string_agg('r.' || quote_ident(k), ', ') from jsonb_object_keys(p_listing_updates) k);
    v_sql  := format(
      'update listings t set (%s) = (select %s from jsonb_populate_record(null::listings, $1) r) where t.id = $2',
      v_cols, v_sel
    );
    execute v_sql using p_listing_updates, p_listing_id;
  end if;

  if p_unit_updates is not null then
    for v_item in select * from jsonb_array_elements(p_unit_updates) loop
      update listing_units
         set available = (v_item->>'available')::boolean
       where id = (v_item->>'id')::uuid
         and listing_id = p_listing_id;
      if found then v_units_touched := v_units_touched + 1; end if;
    end loop;
  end if;

  if p_lease_updates is not null then
    for v_item in select * from jsonb_array_elements(p_lease_updates) loop
      v_unit_id := (v_item->>'unit_id')::uuid;
      v_rent    := nullif(v_item->>'rent', '')::numeric;
      v_avail   := nullif(v_item->>'available_from', '')::date;

      -- only touch units that belong to this listing
      if not exists (select 1 from listing_units where id = v_unit_id and listing_id = p_listing_id) then
        continue;
      end if;

      update unit_leases
         set rent           = coalesce(v_rent, rent),
             available_from = coalesce(v_avail, available_from)
       where unit_id = v_unit_id and is_active = true;

      if not found and (v_rent is not null or v_avail is not null) then
        insert into unit_leases (unit_id, rent, is_active, available_from)
        values (v_unit_id, v_rent, true, v_avail);
      end if;
      v_leases_touched := v_leases_touched + 1;
    end loop;
  end if;

  return jsonb_build_object('units', v_units_touched, 'leases', v_leases_touched);
end;
$$;

-- Stamp a listing as verified by a PMS source (e.g. 'pms:buildium').
create or replace function rpc_pms_mark_verified(
  p_user_id    uuid,
  p_listing_id uuid,
  p_source     text
) returns void
language plpgsql security definer as $$
begin
  perform set_config('app.current_user_id', p_user_id::text, true);
  update listings
     set last_verified_at     = now(),
         last_verified_by     = p_user_id,
         last_verified_source = p_source,
         pms_stale_flagged_at = null
   where id = p_listing_id;
end;
$$;

-- Create a listing from PMS data: reuses rpc_create_listing, then stamps
-- the PMS connection + verification columns in the same transaction.
create or replace function rpc_pms_ingest_listing(
  p_user_id            uuid,
  p_connection_id      uuid,
  p_listing_data       jsonb,
  p_amenities          jsonb default '{}',
  p_utilities          jsonb default '{}',
  p_walk_times         jsonb default '[]',
  p_drive_times        jsonb default '[]',
  p_units              jsonb default '[]',
  p_lease_availability text  default null,
  p_source             text  default 'pms'
) returns uuid
language plpgsql security definer as $$
declare
  v_listing_id uuid;
begin
  v_listing_id := rpc_create_listing(
    p_user_id            => p_user_id,
    p_listing_data       => p_listing_data,
    p_amenities          => p_amenities,
    p_utilities          => p_utilities,
    p_walk_times         => p_walk_times,
    p_drive_times        => p_drive_times,
    p_units              => p_units,
    p_lease_availability => p_lease_availability
  );

  perform set_config('app.current_user_id', p_user_id::text, true);
  update listings
     set pms_connection_id    = p_connection_id,
         last_verified_at     = now(),
         last_verified_by     = p_user_id,
         last_verified_source = p_source
   where id = v_listing_id;

  return v_listing_id;
end;
$$;
