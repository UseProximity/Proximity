-- Creates review_votes and migrates from upvotes + downvotes uuid[] arrays on `reviews`
-- (the legacy source; 0017 copies rows into listing_reviews but does NOT carry vote arrays).
-- review_votes.review_id FKs listing_reviews.id — matching ids are guaranteed because 0017
-- preserves ids during COPY.
-- On conflict (same user voted both directions), 'down' wins to match legacy toggle logic.

CREATE TABLE IF NOT EXISTS review_votes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id  uuid NOT NULL REFERENCES listing_reviews(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vote       text NOT NULL CHECK (vote IN ('up','down')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (review_id, user_id)
);

-- Migrate upvotes uuid[] → 'up' votes. Read from `reviews` (legacy source).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='reviews' AND column_name='upvotes'
  ) THEN
    INSERT INTO review_votes (review_id, user_id, vote)
    SELECT r.id, unnest(r.upvotes), 'up'
    FROM reviews r
    WHERE r.upvotes IS NOT NULL
      AND array_length(r.upvotes, 1) > 0
      AND EXISTS (SELECT 1 FROM listing_reviews lr WHERE lr.id = r.id)
    ON CONFLICT (review_id, user_id) DO NOTHING;
  END IF;
END $$;

-- Migrate downvotes uuid[] → 'down' votes (overwrites if user had both).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='reviews' AND column_name='downvotes'
  ) THEN
    INSERT INTO review_votes (review_id, user_id, vote)
    SELECT r.id, unnest(r.downvotes), 'down'
    FROM reviews r
    WHERE r.downvotes IS NOT NULL
      AND array_length(r.downvotes, 1) > 0
      AND EXISTS (SELECT 1 FROM listing_reviews lr WHERE lr.id = r.id)
    ON CONFLICT (review_id, user_id) DO UPDATE SET vote = 'down';
  END IF;
END $$;

-- NOTE: DROP COLUMN upvotes/downvotes deferred — those live on `reviews`, which is
-- dropped whole in Phase 3 (0028).

CREATE INDEX IF NOT EXISTS idx_review_votes_review ON review_votes (review_id, vote);
CREATE INDEX IF NOT EXISTS idx_review_votes_user   ON review_votes (user_id);

DO $$ DECLARE v_count bigint;
BEGIN
  SELECT COUNT(*) INTO v_count FROM review_votes;
  RAISE NOTICE 'Migration 0018: % review_votes migrated.', v_count;
END $$;
