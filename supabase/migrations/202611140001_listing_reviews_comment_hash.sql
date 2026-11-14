-- One copy of a review per person, listing and text.
--
-- lib/reviews/duplicate.js already answers a resubmission with the review that
-- is there, but a check followed by an insert cannot stop two submissions that
-- arrive together (a phone retrying while the first request is still running,
-- or two tabs). Both see nothing and both insert. This index makes the second
-- insert fail, and the routes answer that failure as a repeat.
--
-- The text is compared by its md5 rather than as a raw value because the
-- lookup sends it in a query string, which long reviews overflow, and because
-- a btree index entry cannot hold a review of several thousand words.
--
-- The app stores comments trimmed and hashes the trimmed text in Node with the
-- same UTF-8 md5, so both sides agree. Checked before writing: no live
-- duplicates on dev or prod, so the unique index builds.

ALTER TABLE public.listing_reviews
  ADD COLUMN IF NOT EXISTS comment_hash text
  GENERATED ALWAYS AS (md5(comment)) STORED;

CREATE UNIQUE INDEX IF NOT EXISTS listing_reviews_one_copy_idx
  ON public.listing_reviews (user_id, listing_id, comment_hash)
  WHERE deleted_at IS NULL;
