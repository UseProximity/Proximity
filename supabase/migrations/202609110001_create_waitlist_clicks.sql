/*
 * waitlist_clicks: one row per click on a property's external waitlist button.
 *
 * Some properties run their own waitlist off-site (LOCAL on Delmar's is a
 * Google Form). We send students there and get paid a commission when one of
 * them signs, so we need our own record of who we sent and when. This table is
 * that record.
 *
 * What it can and cannot prove. The form lives on Google's domain, so nothing
 * here can observe a submission: cookies do not cross to docs.google.com and
 * the page is not ours to instrument. A row means "this person left for the
 * waitlist", never "this person joined it". Treat the count as the top of the
 * funnel and reconcile against the property's own response sheet before
 * invoicing anyone.
 *
 * Identity is best-effort and arrives two ways. A signed-in student is named by
 * user_id outright. A signed-out one is asked for name/email/phone first, which
 * both prefills the landlord's form and mints a shell account, so user_id is set
 * for them too; the typed values are kept here alongside it because they are
 * what we actually sent to the landlord and may differ from what the account
 * later says. visitor_id (the prx_vid cookie) is the fallback that collapses
 * repeat clicks from one signed-out browser into one person.
 *
 * No unique constraint: a ledger of clicks, not of people. Someone who clicks
 * twice genuinely clicked twice, and collapsing that here would throw away the
 * timestamps that make a funnel readable.
 *
 * RLS on with NO policies, service-role only. This joins a named user to an
 * off-site action they took, so it must never be reachable from the browser key.
 */
create table if not exists public.waitlist_clicks (
  id         uuid primary key default gen_random_uuid(),
  listing_id uuid        not null references public.listings(id) on delete cascade,
  user_id    uuid        references public.users(id) on delete set null,
  visitor_id text,
  -- What the student typed on our side, and what we injected into the
  -- landlord's form. Null on a signed-in click, which skips the interstitial.
  name       text,
  email      text,
  phone      text,
  -- Where on the site they clicked from, so we can tell a browse-page click
  -- from one that followed a matchmaking recommendation.
  referrer   text,
  /*
   * Stamped when the "finish your account" nudge goes out. Set on EVERY row for
   * that user, not just the one that triggered it, so a student who clicked
   * three times is still only mailed once.
   */
  nudge_sent_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists waitlist_clicks_listing_id_created_at_idx
  on public.waitlist_clicks (listing_id, created_at desc);

create index if not exists waitlist_clicks_user_id_idx
  on public.waitlist_clicks (user_id)
  where user_id is not null;

-- Drives the nudge cron: the unmailed, attributable clicks, oldest first.
create index if not exists waitlist_clicks_pending_nudge_idx
  on public.waitlist_clicks (created_at)
  where nudge_sent_at is null and user_id is not null;

alter table public.waitlist_clicks enable row level security;
