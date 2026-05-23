-- Add per-unit availability flag.
-- Lets a landlord hide an individual unit from browse without taking the whole listing offline.
ALTER TABLE listing_units
  ADD COLUMN IF NOT EXISTS available BOOLEAN NOT NULL DEFAULT true;

DO $$ BEGIN
  RAISE NOTICE 'Migration 202605230001: listing_units.available added (default true).';
END $$;
