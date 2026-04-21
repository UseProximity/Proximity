-- Migrates dorms: adds deleted_at, creates dorm_room_types junction from any room_types array.

ALTER TABLE dorms ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE dorms ADD COLUMN IF NOT EXISTS school_id  uuid REFERENCES schools(id) ON DELETE SET NULL;

-- dorm_room_types: stores room type strings per dorm (e.g. 'single', 'double', 'suite').
CREATE TABLE IF NOT EXISTS dorm_room_types (
  dorm_id     uuid NOT NULL REFERENCES dorms(id) ON DELETE CASCADE,
  room_type   text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (dorm_id, room_type)
);

-- Migrate room_types text[] array if it exists.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'dorms' AND column_name = 'room_types'
  ) THEN
    INSERT INTO dorm_room_types (dorm_id, room_type)
    SELECT d.id, unnest(d.room_types)
    FROM dorms d
    WHERE d.room_types IS NOT NULL AND array_length(d.room_types, 1) > 0
    ON CONFLICT (dorm_id, room_type) DO NOTHING;

    -- NOTE: DROP COLUMN dorms.room_types deferred to Phase 3 (0025) so old main code's
    -- reads don't fail during the validation window.
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_dorm_room_types_dorm ON dorm_room_types (dorm_id);
CREATE INDEX IF NOT EXISTS idx_dorms_school         ON dorms (school_id) WHERE school_id IS NOT NULL;

DO $$ DECLARE v_count bigint;
BEGIN
  SELECT COUNT(*) INTO v_count FROM dorms;
  RAISE NOTICE 'Migration 0019: dorms migrated. % dorm rows.', v_count;
END $$;
