CREATE TABLE IF NOT EXISTS listing_review_replies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  review_id uuid NOT NULL UNIQUE
    REFERENCES listing_reviews(id)
    ON DELETE CASCADE,

  user_id uuid NOT NULL
    REFERENCES users(id)
    ON DELETE CASCADE,

  reply text NOT NULL,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_listing_review_replies_review
ON listing_review_replies(review_id);

CREATE INDEX IF NOT EXISTS idx_listing_review_replies_user
ON listing_review_replies(user_id);

ALTER TABLE listing_review_replies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS listing_review_replies_select
ON listing_review_replies;

DROP POLICY IF EXISTS listing_review_replies_write
ON listing_review_replies;

CREATE POLICY listing_review_replies_select
ON listing_review_replies
FOR SELECT
USING (deleted_at IS NULL);

CREATE POLICY listing_review_replies_write
ON listing_review_replies
FOR ALL
USING (
  fn_current_user_role() = 'super'
  OR EXISTS (
    SELECT 1
    FROM listing_reviews lr
    JOIN listing_landlords ll
      ON ll.listing_id = lr.listing_id
    WHERE lr.id = listing_review_replies.review_id
      AND ll.user_id = fn_current_user_id()
  )
);

CREATE TRIGGER listing_review_replies_set_updated_at
BEFORE UPDATE ON listing_review_replies
FOR EACH ROW
EXECUTE FUNCTION fn_set_updated_at();

DO $$
BEGIN
  RAISE NOTICE 'Migration: listing_review_replies created.';
END $$;