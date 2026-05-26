-- Referral tracking for ambassador-driven reviews.
--
-- Ambassadors share a link (/refer/<userId>) that students use to leave a review for a
-- property they've lived in. Each review submitted through that link records:
--   * referrer_id    — the ambassador whose link drove the submission (for leaderboards)
--   * reviewer_email  — contact email captured when the reviewer is NOT logged in
-- The reviewer's name (when anonymous) reuses the existing listing_reviews.name column.

ALTER TABLE listing_reviews
  ADD COLUMN IF NOT EXISTS referrer_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reviewer_email text;

CREATE INDEX IF NOT EXISTS idx_listing_reviews_referrer
  ON listing_reviews (referrer_id) WHERE referrer_id IS NOT NULL;
