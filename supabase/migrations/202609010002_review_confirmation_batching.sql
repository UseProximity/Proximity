/*
 * Batched review confirmations.
 *
 * A review used to email the reviewer the moment it posted, so a student who
 * reviewed two places got two near-identical emails. Confirmation is now
 * deferred and batched per reviewer: one email naming every place they just
 * reviewed, sent when they leave the review loop or, if they abandon it,
 * by the 30-minute sweep in /api/cron/review-confirmations.
 *
 * confirmation_sent_at is what makes that safe. It is the idempotency key —
 * a review is picked up only while it is null, and stamped as part of the
 * send — so a crash mid-batch, an overlapping cron run, and an explicit flush
 * racing the sweep all resolve to exactly one email.
 */
alter table public.listing_reviews
  add column if not exists confirmation_sent_at timestamptz;

alter table public.dorm_reviews
  add column if not exists confirmation_sent_at timestamptz;

-- The sweep looks only for reviews still awaiting a confirmation, so index just those.
create index if not exists listing_reviews_pending_confirmation_idx
  on public.listing_reviews (user_id, created_at)
  where confirmation_sent_at is null;

create index if not exists dorm_reviews_pending_confirmation_idx
  on public.dorm_reviews (user_id, created_at)
  where confirmation_sent_at is null;

/*
 * Backfill every review that already exists.
 *
 * Without this the first sweep after deploy treats the entire back catalogue as
 * unconfirmed and emails months-old reviews to the students who wrote them.
 * Applied to production on 2026-09-03: 166 rows (100 listing, 66 dorm) across
 * 43 people, every one stamped with its own created_at.
 *
 * created_at is the honest stamp rather than now(): under the previous
 * behaviour a confirmation really did go out the moment each review posted, so
 * this records when that happened rather than inventing a fresh send.
 */
update public.listing_reviews
set confirmation_sent_at = coalesce(created_at, now())
where confirmation_sent_at is null;

update public.dorm_reviews
set confirmation_sent_at = coalesce(created_at, now())
where confirmation_sent_at is null;
