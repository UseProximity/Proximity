-- Creates all lookup/reference tables. Idempotent: IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS roles (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS home_types (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label      text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lease_structures (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label           text NOT NULL UNIQUE,
  duration_months integer,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS metric_types (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS interaction_types (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS thread_types (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL UNIQUE,
  description text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tags (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS location_types (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS priority_types (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Parent tables referenced by later migrations but absent on some envs (e.g. prod).
-- Dev had these pre-migration; prod never did. IF NOT EXISTS keeps this idempotent.
CREATE TABLE IF NOT EXISTS schools (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  short_name text,
  city       text,
  state      text,
  latitude   numeric(10,7),
  longitude  numeric(11,7),
  website    text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Seed WashU so downstream school_id FKs can populate.
INSERT INTO schools (name, short_name, city, state, latitude, longitude, website)
SELECT 'Washington University in St. Louis', 'WashU', 'St. Louis', 'MO', 38.6488, -90.3108, 'https://wustl.edu'
WHERE NOT EXISTS (SELECT 1 FROM schools WHERE short_name = 'WashU');

CREATE TABLE IF NOT EXISTS listing_landlords (
  listing_id uuid NOT NULL,
  user_id    uuid NOT NULL,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN RAISE NOTICE 'Migration 0001: lookup tables + schools + listing_landlords created (IF NOT EXISTS).'; END $$;
