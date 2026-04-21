-- Migrates listing_landlords: renames columns, adds is_primary, populates from listings.landlord_id[].

-- Rename landlord_id → user_id if still using old name.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'listing_landlords' AND column_name = 'landlord_id'
  ) THEN
    ALTER TABLE listing_landlords RENAME COLUMN landlord_id TO user_id;
  END IF;
END $$;

-- Rename assigned_at → created_at if still using old name.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'listing_landlords' AND column_name = 'assigned_at'
  ) THEN
    ALTER TABLE listing_landlords RENAME COLUMN assigned_at TO created_at;
  END IF;
END $$;

ALTER TABLE listing_landlords ADD COLUMN IF NOT EXISTS is_primary boolean NOT NULL DEFAULT false;

-- Add FK constraints if missing.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'listing_landlords' AND constraint_name = 'listing_landlords_listing_id_fkey'
  ) THEN
    ALTER TABLE listing_landlords
      ADD CONSTRAINT listing_landlords_listing_id_fkey
      FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'listing_landlords' AND constraint_name = 'listing_landlords_user_id_fkey'
  ) THEN
    ALTER TABLE listing_landlords
      ADD CONSTRAINT listing_landlords_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'listing_landlords' AND constraint_type = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE listing_landlords ADD PRIMARY KEY (listing_id, user_id);
  END IF;
END $$;

-- Populate from listings.landlord_id uuid[] array (for listings not already in table).
INSERT INTO listing_landlords (listing_id, user_id, is_primary)
SELECT
  l.id,
  unnest(l.landlord_id),
  -- First element of the array is the primary landlord.
  (unnest(l.landlord_id) = l.landlord_id[1])
FROM listings l
WHERE l.landlord_id IS NOT NULL
  AND array_length(l.landlord_id, 1) > 0
ON CONFLICT (listing_id, user_id) DO NOTHING;

-- Ensure first landlord is marked primary for all existing rows.
UPDATE listing_landlords ll
SET is_primary = true
WHERE ll.is_primary = false
  AND ll.user_id = (
    SELECT landlord_id[1] FROM listings l WHERE l.id = ll.listing_id
  );

CREATE INDEX IF NOT EXISTS idx_listing_landlords_user ON listing_landlords (user_id);

DO $$
DECLARE v_count bigint;
BEGIN
  SELECT COUNT(*) INTO v_count FROM listing_landlords;
  RAISE NOTICE 'Migration 0008: % rows in listing_landlords.', v_count;
END $$;
