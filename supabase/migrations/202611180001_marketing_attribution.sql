/*
 * Marketing attribution, phase 1 (Project 5 PRD, section 8).
 *
 * Captures the campaign a visitor arrives with, holds it for that visit, and
 * records a defined set of outcomes against it. Four tables plus four columns
 * on users:
 *
 *   marketing_links        admin-registered campaign links (slug -> labels)
 *   marketing_sessions     one row per visit, owned by its FIRST source
 *   marketing_touchpoints  later campaign arrivals inside a live session
 *   marketing_outcomes     canonical outcomes, deduplicated by dedupe_key
 *   users.signup_*         the source an account arrived from
 *
 * A session lasts until 30 minutes of inactivity (tracked by last_seen_at and a
 * session-only cookie). No names, emails or IP addresses are stored in any of
 * these tables.
 *
 * All four tables: RLS on with NO policies, service-role only (same pattern as
 * waitlist_clicks). No SECURITY DEFINER functions. The two trigger functions
 * below run with the caller's rights.
 *
 * Idempotent: safe to re-run. Not destructive: only creates objects and adds
 * nullable columns to users. Apply to dev first, verify, then prod.
 */

-- ---------------------------------------------------------------------------
-- marketing_links
-- ---------------------------------------------------------------------------
create table if not exists public.marketing_links (
  id               uuid primary key default gen_random_uuid(),
  -- Printed on paper and baked into QR codes, so it is locked after insert
  -- (trigger below). Same character set as the shared tag cleaner.
  slug             text        not null,
  -- For people only. Never appears in a URL.
  name             text        not null,
  source           text        not null,
  medium           text        not null,
  campaign         text        not null,
  content          text,
  -- A path on our own domain, never a full URL: "/", "/browse", "/guides/x?y=1".
  -- The /go/<slug> short link follows it, so it may change at any time.
  destination_path text        not null default '/',
  status           text        not null default 'active',
  created_by       uuid        references public.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint marketing_links_slug_key unique (slug),
  constraint marketing_links_slug_format check (slug ~ '^[a-z0-9_-]{1,40}$'),
  constraint marketing_links_name_length check (char_length(name) between 1 and 120),
  constraint marketing_links_labels_format check (
    source   ~ '^[a-z0-9_-]{1,40}$' and
    medium   ~ '^[a-z0-9_-]{1,40}$' and
    campaign ~ '^[a-z0-9_-]{1,40}$' and
    (content is null or content ~ '^[a-z0-9_-]{1,40}$')
  ),
  -- Our domain only: must start with a single "/" (rejects "//evil.com" and
  -- "https://..."), no backslashes or whitespace, bounded length.
  constraint marketing_links_destination_path_check check (
    char_length(destination_path) <= 500 and
    (destination_path = '/' or destination_path ~ '^/[^/]') and
    destination_path !~ '[[:space:]\\]'
  ),
  constraint marketing_links_status_check check (status in ('active', 'archived'))
);

create index if not exists marketing_links_status_idx
  on public.marketing_links (status, created_at desc);

create index if not exists marketing_links_campaign_idx
  on public.marketing_links (campaign);

alter table public.marketing_links enable row level security;
revoke all on public.marketing_links from anon, authenticated;

-- Slug lock: a printed code must never be orphaned by a rename.
create or replace function public.fn_marketing_links_lock_slug()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.slug is distinct from old.slug then
    raise exception 'marketing_links.slug cannot be changed once saved'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function public.fn_marketing_links_lock_slug() from public, anon, authenticated;

drop trigger if exists trg_marketing_links_lock_slug on public.marketing_links;
create trigger trg_marketing_links_lock_slug
  before update on public.marketing_links
  for each row execute function public.fn_marketing_links_lock_slug();

drop trigger if exists trg_set_updated_at_marketing_links on public.marketing_links;
create trigger trg_set_updated_at_marketing_links
  before update on public.marketing_links
  for each row execute function fn_set_updated_at();

-- Every create, edit, archive and delete goes to the existing action_log.
drop trigger if exists trg_action_log_marketing_links on public.marketing_links;
create trigger trg_action_log_marketing_links
  after insert or update or delete on public.marketing_links
  for each row execute function fn_action_log();

-- ---------------------------------------------------------------------------
-- marketing_sessions
-- ---------------------------------------------------------------------------
create table if not exists public.marketing_sessions (
  id              uuid primary key default gen_random_uuid(),
  started_at      timestamptz not null default now(),
  -- Renewed by every beacon. A session is live while this is under 30 min old.
  last_seen_at    timestamptz not null default now(),
  -- The first source owns the session and never changes afterwards.
  source          text        not null,
  medium          text        not null,
  campaign        text,
  content         text,
  term            text,
  -- Google Ads click id. Kept whenever present, whichever rule classified the visit.
  gclid           text,
  classified_from text        not null,
  -- Restrict: a link that has sessions can only be archived, never deleted.
  link_id         uuid        references public.marketing_links(id) on delete restrict,
  landing_path    text,
  referrer_host   text,
  -- True when the tag cleaner changed or truncated any incoming value
  -- (feeds the Data quality block).
  tags_cleaned    boolean     not null default false,
  user_id         uuid        references public.users(id) on delete cascade,

  constraint marketing_sessions_classified_from_check check (
    classified_from in ('link', 'utm', 'src', 'gclid', 'referrer', 'direct')
  ),
  constraint marketing_sessions_gclid_length check (gclid is null or char_length(gclid) <= 200),
  constraint marketing_sessions_landing_path_length check (landing_path is null or char_length(landing_path) <= 500),
  constraint marketing_sessions_referrer_host_length check (referrer_host is null or char_length(referrer_host) <= 255)
);

create index if not exists marketing_sessions_started_at_idx
  on public.marketing_sessions (started_at desc);

create index if not exists marketing_sessions_source_campaign_idx
  on public.marketing_sessions (source, campaign);

create index if not exists marketing_sessions_link_id_idx
  on public.marketing_sessions (link_id)
  where link_id is not null;

create index if not exists marketing_sessions_user_id_idx
  on public.marketing_sessions (user_id)
  where user_id is not null;

-- Drives the 13-month retention job: old sessions never linked to an account.
create index if not exists marketing_sessions_unlinked_retention_idx
  on public.marketing_sessions (started_at)
  where user_id is null;

alter table public.marketing_sessions enable row level security;
revoke all on public.marketing_sessions from anon, authenticated;

-- ---------------------------------------------------------------------------
-- marketing_touchpoints
-- ---------------------------------------------------------------------------
create table if not exists public.marketing_touchpoints (
  id              uuid primary key default gen_random_uuid(),
  session_id      uuid        not null references public.marketing_sessions(id) on delete cascade,
  occurred_at     timestamptz not null default now(),
  source          text        not null,
  medium          text        not null,
  campaign        text,
  content         text,
  term            text,
  gclid           text,
  classified_from text        not null,
  link_id         uuid        references public.marketing_links(id) on delete restrict,
  path            text,

  constraint marketing_touchpoints_classified_from_check check (
    classified_from in ('link', 'utm', 'src', 'gclid', 'referrer', 'direct')
  ),
  constraint marketing_touchpoints_gclid_length check (gclid is null or char_length(gclid) <= 200),
  constraint marketing_touchpoints_path_length check (path is null or char_length(path) <= 500)
);

create index if not exists marketing_touchpoints_session_id_idx
  on public.marketing_touchpoints (session_id, occurred_at);

create index if not exists marketing_touchpoints_occurred_at_idx
  on public.marketing_touchpoints (occurred_at desc);

create index if not exists marketing_touchpoints_link_id_idx
  on public.marketing_touchpoints (link_id)
  where link_id is not null;

alter table public.marketing_touchpoints enable row level security;
revoke all on public.marketing_touchpoints from anon, authenticated;

-- ---------------------------------------------------------------------------
-- marketing_outcomes
-- ---------------------------------------------------------------------------
create table if not exists public.marketing_outcomes (
  id          uuid primary key default gen_random_uuid(),
  -- Null for an outcome with no session (e.g. a mobile app API call).
  session_id  uuid        references public.marketing_sessions(id) on delete cascade,
  user_id     uuid        references public.users(id) on delete cascade,
  outcome     text        not null,
  -- Derived from outcome so the two can never disagree.
  tier        text generated always as (
    case
      when outcome in ('account_created', 'account_activated') then 'account'
      when outcome in ('proxy_question', 'landlord_message', 'tour_requested') then 'inquiry'
      when outcome in ('application_started', 'application_submitted') then 'application'
      else 'engagement'
    end
  ) stored,
  -- Role of the user when the outcome happened, so account outcomes can be
  -- split by student / landlord / parent even if the role changes later.
  user_role   text,
  -- Attribution snapshot at record time: copied from the session, or for a
  -- sessionless outcome resolved from the account's signup_* columns or 'app'.
  source      text,
  medium      text,
  campaign    text,
  link_id     uuid        references public.marketing_links(id) on delete set null,
  -- Listing, review, tour request, application or lease check. Not a foreign
  -- key because it points at different tables depending on the outcome.
  subject_id  uuid,
  occurred_at timestamptz not null default now(),
  -- e.g. proxy_question:<session>:<listing>, application_submitted:<application>,
  -- guides_visit:<session>. Always starts with the outcome name, so different
  -- inquiry channels never collapse into one.
  dedupe_key  text        not null,

  constraint marketing_outcomes_dedupe_key_key unique (dedupe_key),
  constraint marketing_outcomes_outcome_check check (outcome in (
    'account_created',
    'account_activated',
    'proxy_question',
    'landlord_message',
    'tour_requested',
    'application_started',
    'application_submitted',
    'waitlist_click',
    'review_submitted',
    'lease_check_started',
    'lease_check_completed',
    'guides_visit',
    'hub_visit'
  )),
  constraint marketing_outcomes_dedupe_key_prefix check (
    dedupe_key like outcome || ':%' and char_length(dedupe_key) <= 300
  )
);

create index if not exists marketing_outcomes_occurred_at_idx
  on public.marketing_outcomes (occurred_at desc);

create index if not exists marketing_outcomes_outcome_occurred_at_idx
  on public.marketing_outcomes (outcome, occurred_at desc);

create index if not exists marketing_outcomes_session_id_idx
  on public.marketing_outcomes (session_id)
  where session_id is not null;

create index if not exists marketing_outcomes_user_id_idx
  on public.marketing_outcomes (user_id)
  where user_id is not null;

create index if not exists marketing_outcomes_source_campaign_idx
  on public.marketing_outcomes (source, campaign);

create index if not exists marketing_outcomes_link_id_idx
  on public.marketing_outcomes (link_id)
  where link_id is not null;

-- application_submitted looks up the session of the matching
-- application_started by student and listing.
create index if not exists marketing_outcomes_started_lookup_idx
  on public.marketing_outcomes (user_id, subject_id, occurred_at)
  where outcome = 'application_started';

alter table public.marketing_outcomes enable row level security;
revoke all on public.marketing_outcomes from anon, authenticated;

-- ---------------------------------------------------------------------------
-- marketing_outcome_rejections
-- One row each time a duplicate outcome is refused by dedupe_key, so the Data
-- quality block can report "duplicate outcomes rejected". Holds no identity.
-- Deleted after 13 months by the same retention job.
-- ---------------------------------------------------------------------------
create table if not exists public.marketing_outcome_rejections (
  id          uuid primary key default gen_random_uuid(),
  outcome     text        not null,
  occurred_at timestamptz not null default now()
);

create index if not exists marketing_outcome_rejections_occurred_at_idx
  on public.marketing_outcome_rejections (occurred_at desc);

alter table public.marketing_outcome_rejections enable row level security;
revoke all on public.marketing_outcome_rejections from anon, authenticated;

-- ---------------------------------------------------------------------------
-- users: source stamped at account creation.
-- referral_source is NOT touched: it stays the self-reported answer.
-- ---------------------------------------------------------------------------
alter table public.users
  add column if not exists signup_session_id uuid references public.marketing_sessions(id) on delete set null,
  add column if not exists signup_source     text,
  add column if not exists signup_medium     text,
  add column if not exists signup_campaign   text;

create index if not exists users_signup_source_campaign_idx
  on public.users (signup_source, signup_campaign)
  where signup_source is not null;
