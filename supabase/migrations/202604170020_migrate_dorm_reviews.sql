-- Migrates dorm_reviews: adds deleted_at/updated_at, creates dorm_review_tags from tags text[].
-- Tags are free-form strings; unique values are upserted into the tags lookup table first,
-- then linked via dorm_review_tags junction.

ALTER TABLE dorm_reviews ADD COLUMN IF NOT EXISTS deleted_at  timestamptz;
ALTER TABLE dorm_reviews ADD COLUMN IF NOT EXISTS updated_at  timestamptz NOT NULL DEFAULT now();
ALTER TABLE dorm_reviews ADD COLUMN IF NOT EXISTS user_id     uuid REFERENCES users(id) ON DELETE SET NULL;

-- Ensure FK to dorms.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'dorm_reviews' AND constraint_name = 'dorm_reviews_dorm_id_fkey'
  ) THEN
    ALTER TABLE dorm_reviews
      ADD CONSTRAINT dorm_reviews_dorm_id_fkey
      FOREIGN KEY (dorm_id) REFERENCES dorms(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS dorm_review_tags (
  review_id  uuid NOT NULL REFERENCES dorm_reviews(id) ON DELETE CASCADE,
  tag_id     uuid NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (review_id, tag_id)
);

-- Migrate dorm_reviews.tags text[] → tags lookup + dorm_review_tags junction.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'dorm_reviews' AND column_name = 'tags'
  ) THEN
    -- Upsert each unique tag string into the tags lookup table.
    INSERT INTO tags (name)
    SELECT DISTINCT LOWER(TRIM(t))
    FROM dorm_reviews dr, unnest(dr.tags) AS t
    WHERE dr.tags IS NOT NULL AND array_length(dr.tags, 1) > 0
      AND TRIM(t) <> ''
    ON CONFLICT (name) DO NOTHING;

    -- Link reviews to their tag IDs.
    INSERT INTO dorm_review_tags (review_id, tag_id)
    SELECT
      dr.id,
      tg.id
    FROM dorm_reviews dr,
         unnest(dr.tags) AS raw_tag
    JOIN tags tg ON tg.name = LOWER(TRIM(raw_tag))
    WHERE dr.tags IS NOT NULL AND array_length(dr.tags, 1) > 0
      AND TRIM(raw_tag) <> ''
    ON CONFLICT (review_id, tag_id) DO NOTHING;

    -- NOTE: DROP COLUMN dorm_reviews.tags deferred to Phase 3 (0025) so old main code's
    -- reads don't fail during the validation window.
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_dorm_reviews_dorm    ON dorm_reviews (dorm_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_dorm_review_tags_rev ON dorm_review_tags (review_id);
CREATE INDEX IF NOT EXISTS idx_dorm_review_tags_tag ON dorm_review_tags (tag_id);

DO $$ DECLARE v_count bigint;
BEGIN
  SELECT COUNT(*) INTO v_count FROM dorm_reviews;
  RAISE NOTICE 'Migration 0020: % dorm_reviews migrated.', v_count;
END $$;
