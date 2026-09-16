-- QR review onboarding: let a student review a place from a flyer scan without
-- signing in first, then finish their account afterwards.
--
-- Three separate things land here because they are one feature:
--
-- 1. unit_designator on a review. A review has only ever carried free-text
--    unit_number, so "3" could not say whether it meant Floor 3 or Apt 3. The
--    off-campus flow now offers the same designator dropdown the unit-level form
--    uses, and the pair is stored the same way listing_units stores it: same
--    vocabulary, same CHECK, so unitIdentityLabel() renders both identically.
--
-- 2. source on both review tables. A printed QR carries ?src=<tag> naming the
--    flyer it came from. Analytics events see it too, but at flyer volumes GA
--    sampling is not something to attribute spend on. The tag belongs on the
--    row so "how many reviews came from flyer-mudd" is a SQL question.
--
-- 3. profile_setup_token on users. A QR reviewer's account is created mid-flow
--    and is deliberately INCOMPLETE (profile_complete stays false until they
--    fill the profile in themselves). The token authorizes exactly that one
--    action, for a week, on an account that has no password yet. It is not a
--    session and cannot sign anybody in. Mirrors the existing
--    password_reset_token / email_verification_token pattern.

-- ── 1. Review unit identity ──────────────────────────────────────────────────
ALTER TABLE listing_reviews ADD COLUMN IF NOT EXISTS unit_designator text;

ALTER TABLE listing_reviews DROP CONSTRAINT IF EXISTS listing_reviews_designator_check;
ALTER TABLE listing_reviews ADD CONSTRAINT listing_reviews_designator_check
  CHECK (unit_designator IS NULL OR unit_designator IN ('Apt','Unit','Suite','Floor','Room','Whole'));

-- 'Whole' covers the entire property, so it carries no number. Unlike
-- listing_units the converse is NOT enforced: a reviewer may well remember they
-- lived on a floor without remembering which, and losing the review over a
-- missing unit number would be the worse outcome.
ALTER TABLE listing_reviews DROP CONSTRAINT IF EXISTS listing_reviews_unit_number_check;
ALTER TABLE listing_reviews ADD CONSTRAINT listing_reviews_unit_number_check
  CHECK (unit_designator IS DISTINCT FROM 'Whole' OR unit_number IS NULL);

-- ── 2. Campaign attribution ──────────────────────────────────────────────────
ALTER TABLE listing_reviews ADD COLUMN IF NOT EXISTS source text;
ALTER TABLE dorm_reviews    ADD COLUMN IF NOT EXISTS source text;

CREATE INDEX IF NOT EXISTS idx_listing_reviews_source
  ON listing_reviews (source) WHERE source IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dorm_reviews_source
  ON dorm_reviews (source) WHERE source IS NOT NULL;

-- ── 3. Profile-completion token ──────────────────────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_setup_token      text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_setup_expires_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_users_profile_setup_token
  ON users (profile_setup_token)
  WHERE profile_setup_token IS NOT NULL;
