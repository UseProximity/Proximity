-- Listing walkthrough videos (LISTING_VIDEO_BRIEF.md §8).
-- Apply to BOTH dev and prod (supabase-dev / supabase-prod MCP tools) at Phase 1
-- kickoff — the Phase 0 pipeline is file-based and does not read these tables.

-- One row per listing video.
create table listing_videos (
  id                uuid primary key default gen_random_uuid(),
  listing_id        uuid not null references listings(id) on delete cascade,
  status            text not null default 'pending',
                    -- pending|curating|generating|review|published|failed|skipped
  skip_reason       text,
  mode              text,              -- hybrid | kenburns
  url               text,              -- clean / unwatermarked
  watermarked_url   text,
  poster_url        text,
  duration_seconds  numeric,
  manifest          jsonb not null default '{}'::jsonb,  -- R4 provenance
  model             text,
  cost_cents        integer not null default 0,
  error             text,
  generated_at      timestamptz,
  published_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create unique index listing_videos_listing_id_key on listing_videos(listing_id);
create index listing_videos_status_idx on listing_videos(status);

-- Generated-clip cache: makes re-runs free and Phase 2 resumable.
create table listing_video_clips (
  id            uuid primary key default gen_random_uuid(),
  listing_id    uuid references listings(id) on delete cascade,
  cache_key     text not null unique,
  from_image_id uuid references listing_images(id) on delete set null,
  to_image_id   uuid references listing_images(id) on delete set null,
  kind          text not null,         -- generated | safe
  url           text,
  cost_cents    integer not null default 0,
  created_at    timestamptz not null default now()
);

-- Landlord opt-out feedback (Phase 3).
create table listing_video_feedback (
  id          uuid primary key default gen_random_uuid(),
  listing_id  uuid not null references listings(id) on delete cascade,
  video_id    uuid references listing_videos(id) on delete set null,
  landlord_id uuid,
  reason      text,
  created_at  timestamptz not null default now()
);

-- Listing-level control (Phase 3 landlord toggle).
alter table listings add column video_enabled boolean not null default true;
alter table listings add column video_opt_out_at timestamptz;
