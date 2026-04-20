-- Creates unit_leases and migrates from listing_units.rent + lease_availability.
-- Each listing_unit row with a rent value gets one active lease record.

CREATE TABLE IF NOT EXISTS unit_leases (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id            uuid NOT NULL REFERENCES listing_units(id) ON DELETE CASCADE,
  lease_structure_id uuid REFERENCES lease_structures(id),
  rent               numeric(10,2),
  available_from     date,
  is_active          boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- Migrate rent + lease_availability from listing_units.
-- lease_availability may be text or date; use a safe cast via regex guard.
INSERT INTO unit_leases (unit_id, rent, available_from, is_active)
SELECT
  u.id,
  CASE WHEN u.rent IS NOT NULL THEN u.rent::numeric ELSE NULL END,
  CASE
    WHEN u.lease_availability::text ~ '^\d{4}-\d{2}-\d{2}$'
    THEN u.lease_availability::text::date
    ELSE NULL
  END,
  true
FROM listing_units u
WHERE u.rent IS NOT NULL
ON CONFLICT DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_unit_leases_unit      ON unit_leases (unit_id);
CREATE INDEX IF NOT EXISTS idx_unit_leases_active    ON unit_leases (unit_id, is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_unit_leases_available ON unit_leases (available_from) WHERE is_active = true;

DO $$ DECLARE v_count bigint;
BEGIN
  SELECT COUNT(*) INTO v_count FROM unit_leases;
  RAISE NOTICE 'Migration 0013: % unit_leases rows migrated.', v_count;
END $$;
