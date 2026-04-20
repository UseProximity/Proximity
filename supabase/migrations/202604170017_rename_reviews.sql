-- Creates listing_reviews as a COPY of `reviews` (not a rename), so old main code can keep
-- reading from `reviews` during the staging validation window. The old `reviews` table is
-- dropped in Phase 3 (0028) after main is cut over.

-- 1. Create listing_reviews with the v4 schema (no upvotes/downvotes arrays — those migrate
--    to review_votes in 0018, sourced directly from `reviews`).
CREATE TABLE IF NOT EXISTS listing_reviews (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mongo_id             text,
  user_id              uuid REFERENCES users(id) ON DELETE SET NULL,
  listing_id           uuid NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  rating               numeric NOT NULL,
  comment              text NOT NULL,
  legitimacy           boolean NOT NULL DEFAULT false,
  communication_rating integer,
  location_rating      integer,
  value_rating         integer,
  name                 text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  deleted_at           timestamptz
);

-- 2. Copy rows from legacy `reviews` if it still exists. Skip ids already present.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'reviews'
  ) THEN
    INSERT INTO listing_reviews (
      id, mongo_id, user_id, listing_id, rating, comment, legitimacy,
      communication_rating, location_rating, value_rating, name, created_at
    )
    SELECT
      r.id, r.mongo_id, r.user_id, r.listing_id, r.rating, r.comment, r.legitimacy,
      r.communication_rating, r.location_rating, r.value_rating, r.name, r.created_at
    FROM reviews r
    WHERE NOT EXISTS (SELECT 1 FROM listing_reviews lr WHERE lr.id = r.id);
  END IF;
END $$;

-- 3. Indexes.
CREATE INDEX IF NOT EXISTS idx_listing_reviews_listing ON listing_reviews (listing_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_listing_reviews_user    ON listing_reviews (user_id);

DO $$ DECLARE v_count bigint;
BEGIN
  SELECT COUNT(*) INTO v_count FROM listing_reviews;
  RAISE NOTICE 'Migration 0017: listing_reviews has % rows (copied from reviews; source preserved).', v_count;
END $$;
