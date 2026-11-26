/*
 * user_blocks + review_reports: the user-generated-content safety basics that
 * Apple (guideline 1.2) and Google Play expect for an app that shows reviews.
 *
 * user_blocks is a generic user-to-user relationship, deliberately not tied to
 * reviews: "blocker_id does not want to see content from blocked_id". Reviews
 * are the first consumer (a blocked author's reviews are hidden from the
 * blocker only, never deleted or hidden for anyone else); messaging can read
 * the same rows later. There is no unblock UI yet. Until there is, a block is
 * removed by Proximity support deleting the row, and nothing here prevents a
 * DELETE endpoint being added later.
 *
 * review_reports is a plain queue of reports to be looked at by hand. One row
 * per reporter per review (the unique constraint stops repeat reports).
 * reported_user_id is copied from the review at report time so the report still
 * names the author after the review is edited or anonymized; it is null when
 * the review was never linked to an account.
 *
 * Both tables hold only user ids and timestamps. RLS on with NO policies,
 * service-role only: who blocked or reported whom must never be readable with
 * the browser key. Account purge removes a deleted user's rows (see
 * api/cron/purge-accounts); the user rows themselves are tombstoned, not
 * deleted, so ON DELETE CASCADE is only a safety net.
 */
create table if not exists public.user_blocks (
  blocker_id uuid        not null references public.users(id) on delete cascade,
  blocked_id uuid        not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint user_blocks_no_self_block check (blocker_id <> blocked_id)
);

-- "Who has blocked this user" (messaging will ask the reverse direction).
create index if not exists user_blocks_blocked_id_idx
  on public.user_blocks (blocked_id);

create table if not exists public.review_reports (
  id               uuid        primary key default gen_random_uuid(),
  reporter_id      uuid        not null references public.users(id) on delete cascade,
  review_id        uuid        not null references public.listing_reviews(id) on delete cascade,
  reported_user_id uuid        references public.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  constraint review_reports_one_per_reporter unique (reporter_id, review_id)
);

create index if not exists review_reports_review_id_idx
  on public.review_reports (review_id);

alter table public.user_blocks enable row level security;
alter table public.review_reports enable row level security;
