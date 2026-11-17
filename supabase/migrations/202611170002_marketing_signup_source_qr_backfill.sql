/*
 * One-off backfill for marketing attribution (Project 5 PRD, edge case 24).
 *
 * Accounts that arrived through a printed review QR code already carry their
 * source in users.referral_source as "qr:<tag>" (for example "qr:flyer-name").
 * Their source is known, so copy it into the new signup_* columns the same way
 * the live capture labels an unregistered src tag: source "qr", medium
 * "offline", campaign "<tag>" run through the shared tag cleaner rules
 * (lowercase, letters, digits, dash and underscore, 40 characters max).
 *
 * referral_source itself is left untouched. Only rows whose signup_source is
 * still null are written, so this never overwrites a live-captured source.
 *
 * Optional (the PRD says "may"). Idempotent: re-running changes nothing.
 * Requires 202611170001_marketing_attribution.sql. Apply to dev first, verify,
 * then prod.
 */
update public.users
set
  signup_source   = 'qr',
  signup_medium   = 'offline',
  -- Mirrors normalizeReviewSource: other characters become one dash, repeated
  -- dashes collapse, leading and trailing dashes or underscores are trimmed.
  signup_campaign = nullif(
    left(
      regexp_replace(
        regexp_replace(
          regexp_replace(lower(trim(substring(referral_source from 4))), '[^a-z0-9_-]+', '-', 'g'),
          '-{2,}', '-', 'g'
        ),
        '^[-_]+|[-_]+$', '', 'g'
      ),
      40
    ),
    ''
  )
where signup_source is null
  and referral_source ilike 'qr:%';
