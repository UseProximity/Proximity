-- ============================================================
-- Proximity – Supabase Schema
-- Generated from MongoDB models: User, Listing, Review, Dorm, DormReview, Testimonial
--
-- Tables:
--   users, listings, listing_units,
--   reviews, dorms, dorm_reviews, testimonials,
--   user_favorites, user_contacted
--
-- listing_units holds per-unit size/price fields (bedrooms, bathrooms,
-- rent, area, lease_availability).  All other listing-level fields
-- (furnished, utilities_included, lease_structure, move_in_date,
-- sublease_friendly, amenities, unavailable) live on listings.
-- Computed min/max aggregates on listings are kept in sync by the
-- sync_listing_aggregates trigger.
--
-- Run this in the Supabase SQL editor before running migrate-to-supabase.mjs
-- ============================================================

create extension if not exists "pgcrypto";

-- ─────────────────────────────────────────
-- USERS
-- ─────────────────────────────────────────
create table users (
  id               uuid         primary key default gen_random_uuid(),
  mongo_id         text         unique,
  name             text,
  email            text         unique,
  image            text,
  role             text         not null default 'student'
                                check (role in ('student', 'landlord', 'super')),
  birthday         timestamptz,
  description      text         not null default '',
  gender           text         not null default 'unspecified',
  num_reviews      int          not null default 0,
  phone            text         not null default 'N/A',
  profile_complete boolean      not null default false,
  rating           numeric(3,2) not null default 0
                                check (rating >= 0 and rating <= 5),
  referral_source  text         not null default '',
  created_at       timestamptz  not null default now(),
  updated_at       timestamptz  not null default now()
);

-- ─────────────────────────────────────────
-- LISTINGS
-- Listing-level info only.
-- Per-unit details live in listing_units.
--
-- min_rent / max_rent / min_bedrooms / max_bedrooms /
-- min_bathrooms / max_bathrooms / min_area / max_area
-- are read-only aggregates maintained by the
-- sync_listing_aggregates trigger below.
--
-- Joins:
--   listings.landlord_id → users.id  (user.role = 'landlord' | 'super')
-- ─────────────────────────────────────────
create table listings (
  id                   uuid         primary key default gen_random_uuid(),
  mongo_id             text         unique,
  title                text,
  address              text         not null,
  longitude            numeric(11,7) not null,
  latitude             numeric(10,7) not null,
  description          text         not null,
  home_type            text         not null default 'apartment'
                                    check (home_type in ('house', 'apartment', 'condo', 'townhouse')),
  lease_type           text         not null,
  images               text[]       not null default '{}',
  -- Walk times
  place_walk_minutes   jsonb        not null default '{}',  -- { "Olin Library": 8, ... }
  shuttle_walk_minutes int,
  -- Listing-level conditions & lease details
  furnished            boolean      not null default false,
  utilities_included   text[]       not null default '{}',
  lease_structure      text         check (lease_structure in ('individual', 'joint')),
  move_in_date         text,
  sublease_friendly    boolean      not null default false,
  amenities            text[]       not null default '{}',
  unavailable          boolean      not null default false,
  -- Contact info (for listings without a platform landlord account)
  contact_email        text,
  contact_phone        text,
  contact_name         text,
  -- Engagement metrics
  num_reviews          int          not null default 0,
  rating               numeric(3,2) not null default 0
                                    check (rating >= 0 and rating <= 5),
  num_clicks           int          not null default 0,
  num_saves            int          not null default 0,
  -- Aggregates computed from listing_units (do not set manually)
  min_rent             numeric,
  max_rent             numeric,
  min_bedrooms         int,
  max_bedrooms         int,
  min_bathrooms        numeric,
  max_bathrooms        numeric,
  min_area             numeric,
  max_area             numeric,
  -- Owner
  landlord_id          uuid         references users(id) on delete set null,
  created_at           timestamptz  not null default now(),
  updated_at           timestamptz  not null default now()
);

-- ─────────────────────────────────────────
-- LISTING UNITS
-- One row per rentable unit within a listing.
-- All per-unit fields live here; listings aggregates
-- (min/max rent, beds, baths, area) are derived from this table.
--
-- Join: listing_units.listing_id → listings.id
-- ─────────────────────────────────────────
create table listing_units (
  id                 uuid        primary key default gen_random_uuid(),
  listing_id         uuid        not null references listings(id) on delete cascade,
  -- Size & price
  bedrooms           int         not null,
  bathrooms          numeric     not null,
  rent               numeric,                           -- monthly rent in USD
  area               numeric,                           -- sq ft
  -- Lease details
  lease_availability text        check (lease_availability in ('semester', '10-month', '12-month')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- ─────────────────────────────────────────
-- TRIGGER: sync listing aggregate columns
-- Fires after any INSERT, UPDATE, or DELETE on listing_units.
-- Recomputes min/max rent, bedrooms, bathrooms, area on the
-- parent listing row so those columns are always current.
-- ─────────────────────────────────────────
create or replace function sync_listing_aggregates()
returns trigger language plpgsql as $$
declare
  target_id uuid;
begin
  -- Determine which listing to recompute
  if (tg_op = 'DELETE') then
    target_id := old.listing_id;
  else
    target_id := new.listing_id;
  end if;

  update listings
  set
    min_rent      = (select min(rent)      from listing_units where listing_id = target_id),
    max_rent      = (select max(rent)      from listing_units where listing_id = target_id),
    min_bedrooms  = (select min(bedrooms)  from listing_units where listing_id = target_id),
    max_bedrooms  = (select max(bedrooms)  from listing_units where listing_id = target_id),
    min_bathrooms = (select min(bathrooms) from listing_units where listing_id = target_id),
    max_bathrooms = (select max(bathrooms) from listing_units where listing_id = target_id),
    min_area      = (select min(area)      from listing_units where listing_id = target_id),
    max_area      = (select max(area)      from listing_units where listing_id = target_id),
    updated_at    = now()
  where id = target_id;

  return null;
end;
$$;

create trigger trg_sync_listing_aggregates
  after insert or update or delete on listing_units
  for each row execute function sync_listing_aggregates();

-- ─────────────────────────────────────────
-- REVIEWS
-- Listing reviews only. user_id = student reviewer.
-- Joins:
--   reviews.user_id    → users.id  (student)
--   reviews.listing_id → listings.id
-- ─────────────────────────────────────────
create table reviews (
  id                   uuid         primary key default gen_random_uuid(),
  mongo_id             text         unique,
  user_id              uuid         not null references users(id) on delete cascade,
  listing_id           uuid         not null references listings(id) on delete cascade,
  rating               numeric(3,2) not null check (rating >= 0 and rating <= 5),
  comment              text         not null,
  legitimacy           boolean      not null default false,
  communication_rating int          check (communication_rating between 1 and 5),
  location_rating      int          check (location_rating between 1 and 5),
  value_rating         int          check (value_rating between 1 and 5),
  created_at           timestamptz  not null default now(),
  updated_at           timestamptz  not null default now(),
  unique (user_id, listing_id)
);

-- ─────────────────────────────────────────
-- DORMS
-- ─────────────────────────────────────────
create table dorms (
  id          uuid        primary key default gen_random_uuid(),
  mongo_id    text        unique,
  name        text        not null unique,
  room_types  text[]      not null default '{}',
  description text        not null default '',
  tags        text[]      not null default '{}',
  image       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ─────────────────────────────────────────
-- DORM REVIEWS
-- Linked to dorms via FK resolved by name during migration.
-- No user account required — reviewer_name is a plain string.
-- Join: dorm_reviews.dorm_id → dorms.id
-- ─────────────────────────────────────────
create table dorm_reviews (
  id             uuid         primary key default gen_random_uuid(),
  mongo_id       text         unique,
  dorm_id        uuid         not null references dorms(id) on delete cascade,
  reviewer_name  text         not null,
  class_year     int          not null,
  rating         numeric(3,2) not null check (rating >= 1 and rating <= 5),
  dorm_type      text         not null default '',
  tags           text[]       not null default '{}',
  content        text         not null,
  created_at     timestamptz  not null default now(),
  updated_at     timestamptz  not null default now()
);

-- ─────────────────────────────────────────
-- TESTIMONIALS
-- Standalone — no foreign keys.
-- ─────────────────────────────────────────
create table testimonials (
  id          uuid         primary key default gen_random_uuid(),
  mongo_id    text         unique,
  text        text         not null,
  author      text         not null,
  rating      numeric(3,2) not null check (rating >= 1 and rating <= 5),
  created_at  timestamptz  not null default now(),
  updated_at  timestamptz  not null default now()
);

-- ─────────────────────────────────────────
-- USER FAVORITES  (many-to-many)
-- ─────────────────────────────────────────
create table user_favorites (
  user_id    uuid        not null references users(id) on delete cascade,
  listing_id uuid        not null references listings(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, listing_id)
);

-- ─────────────────────────────────────────
-- USER CONTACTED  (many-to-many)
-- ─────────────────────────────────────────
create table user_contacted (
  user_id    uuid        not null references users(id) on delete cascade,
  listing_id uuid        not null references listings(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, listing_id)
);

-- ─────────────────────────────────────────
-- INDEXES
-- ─────────────────────────────────────────
create index on listings (landlord_id);
create index on listings (home_type);
create index on listings (lease_type);
create index on listings (latitude, longitude);
create index on listings (min_rent, max_rent);
create index on listing_units (listing_id);
create index on listing_units (bedrooms);
create index on listing_units (rent);
create index on listings (unavailable);
create index on reviews (listing_id);
create index on reviews (user_id);
create index on dorm_reviews (dorm_id);
create index on user_favorites (user_id);
create index on user_favorites (listing_id);
create index on user_contacted (user_id);
create index on user_contacted (listing_id);

-- ─────────────────────────────────────────
-- AUTO-UPDATE updated_at TRIGGER
-- ─────────────────────────────────────────
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_users_updated_at
  before update on users
  for each row execute function set_updated_at();

create trigger trg_listings_updated_at
  before update on listings
  for each row execute function set_updated_at();

create trigger trg_listing_units_updated_at
  before update on listing_units
  for each row execute function set_updated_at();

create trigger trg_reviews_updated_at
  before update on reviews
  for each row execute function set_updated_at();

create trigger trg_dorms_updated_at
  before update on dorms
  for each row execute function set_updated_at();

create trigger trg_dorm_reviews_updated_at
  before update on dorm_reviews
  for each row execute function set_updated_at();

create trigger trg_testimonials_updated_at
  before update on testimonials
  for each row execute function set_updated_at();
