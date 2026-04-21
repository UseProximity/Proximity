-- Adds sublease boolean to unit_leases so lease type can be derived per-lease
-- rather than from the listing-level sublease_friendly flag.

ALTER TABLE unit_leases ADD COLUMN IF NOT EXISTS sublease boolean NOT NULL DEFAULT false;
