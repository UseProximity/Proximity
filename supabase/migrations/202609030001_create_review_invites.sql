/*
 * review_invites: one row per invite we mail, and the proof behind a verified review.
 *
 * The problem it solves: the signed-out review form asks a stranger for their
 * school email and believes the answer. Typing a classmate's address is enough
 * to post under their name. An invite closes that hole by turning the emailed
 * link itself into the proof: the token only ever existed in one inbox, so
 * whoever opens it controls that address. The review's email is then taken from
 * this row and never from the browser.
 *
 * token_hash is the SHA-256 of the token, never the token. The plaintext is
 * generated at send time, handed straight to the email, and discarded. Nothing
 * in this table can be replayed into a working link, so a dump of it cannot
 * forge a review.
 *
 * A LEDGER, not a status column on student_roster. One person can be invited
 * more than once (a reminder, a second campaign, a resend after a bounce), and
 * a roster re-import must never be able to clobber campaign history. Invites to
 * addresses that are not on any roster are equally at home here: roster_id is
 * nullable precisely so an ad-hoc invite has somewhere to live.
 *
 * Holds email addresses for people without accounts, so RLS is on with NO
 * policies: service-role only, never reachable from the browser key.
 */
create table if not exists public.review_invites (
  id            uuid primary key default gen_random_uuid(),
  token_hash    text        not null,
  invited_email text        not null,
  roster_id     uuid        references public.student_roster(id) on delete set null,
  -- Set when the invite is about a specific property, so the form can open on
  -- it. Null for an open invite that lets them pick any address.
  listing_id    uuid        references public.listings(id) on delete set null,
  invited_by    uuid        references public.users(id) on delete set null,
  sent_at       timestamptz,
  expires_at    timestamptz not null,
  used_at       timestamptz,
  /*
   * The review this invite produced. Deliberately NOT a foreign key: a review
   * is either a listing_review or a dorm_review, and review_kind says which.
   * A single FK cannot point at two tables, and splitting it into two nullable
   * columns buys nothing that this pair doesn't.
   */
  review_id     uuid,
  review_kind   text        check (review_kind in ('listing', 'dorm')),
  created_at    timestamptz not null default now()
);

-- Every lookup arrives as a hash and must resolve to exactly one invite.
create unique index if not exists review_invites_token_hash_key
  on public.review_invites (token_hash);

-- "Has this person been invited, and did they use it?" is the question the
-- admin list and any future reminder pass both ask.
create index if not exists review_invites_email_idx
  on public.review_invites (lower(invited_email));

-- The sent-but-unused set: what a reminder pass would work from.
create index if not exists review_invites_outstanding_idx
  on public.review_invites (expires_at)
  where used_at is null;

alter table public.review_invites enable row level security;

/*
 * student_roster.token_hash was written for a design where every roster row
 * carried one permanent token, minted in bulk ahead of any send. That design is
 * gone: tokens are now minted at send time and live here, one per invite, so a
 * token that is never sent never exists. The column was never populated on
 * either database (0 of 6595 rows), so this drops a column that only invited
 * writing the token in two places.
 */
drop index if exists public.student_roster_token_hash_key;

alter table public.student_roster
  drop column if exists token_hash;
