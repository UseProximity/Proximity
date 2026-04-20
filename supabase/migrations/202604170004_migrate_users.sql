-- Adds v4 columns to users, inserts reserved system rows, migrates role text → role_id FK.

ALTER TABLE users ADD COLUMN IF NOT EXISTS role_id          uuid REFERENCES roles(id);
ALTER TABLE users ADD COLUMN IF NOT EXISTS school_id        uuid REFERENCES schools(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_system        boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at       timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS graduation_year  integer;
ALTER TABLE users ADD COLUMN IF NOT EXISTS graduation_month integer;
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at       timestamptz NOT NULL DEFAULT now();

-- Insert three reserved system rows (fixed UUIDs, idempotent via ON CONFLICT).
INSERT INTO users (id, name, email, profile_complete, is_system, role_id)
SELECT
  '00000000-0000-0000-0000-000000000001',
  'System', 'system@internal', true, true,
  (SELECT id FROM roles WHERE name = 'system')
ON CONFLICT (id) DO NOTHING;

INSERT INTO users (id, name, email, profile_complete, is_system, role_id)
SELECT
  '00000000-0000-0000-0000-000000000002',
  'Migration', 'migration@internal', true, true,
  (SELECT id FROM roles WHERE name = 'system')
ON CONFLICT (id) DO NOTHING;

INSERT INTO users (id, name, email, profile_complete, is_system, role_id)
SELECT
  '00000000-0000-0000-0000-000000000003',
  'Trigger', 'trigger@internal', true, true,
  (SELECT id FROM roles WHERE name = 'system')
ON CONFLICT (id) DO NOTHING;

-- Migrate role text → role_id FK for all real users.
UPDATE users u
SET role_id = r.id
FROM roles r
WHERE r.name = u.role
  AND u.role_id IS NULL;

-- Any remaining unmatched rows fall back to 'student'.
UPDATE users u
SET role_id = (SELECT id FROM roles WHERE name = 'student')
WHERE u.role_id IS NULL;

-- NOTE: Deferred to Phase 3 (0025):
--   ALTER TABLE users ALTER COLUMN role_id SET NOT NULL
--   DROP COLUMN mongo_id, num_reviews, rating
-- Reason: old main code INSERTs users without role_id (writes `role` text). A NOT NULL
-- constraint would break signups during the validation window. mongo_id / num_reviews /
-- rating kept so old main code's reads don't fail.

CREATE INDEX IF NOT EXISTS idx_users_role       ON users (role_id);
CREATE INDEX IF NOT EXISTS idx_users_deleted_at ON users (deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_users_school     ON users (school_id) WHERE school_id IS NOT NULL;

DO $$
DECLARE v_count bigint;
BEGIN
  SELECT COUNT(*) INTO v_count FROM users WHERE role_id IS NOT NULL AND is_system = false;
  RAISE NOTICE 'Migration 0004: % real users migrated with role_id.', v_count;
END $$;
