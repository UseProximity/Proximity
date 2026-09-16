/*
 * student_roster — imported class rosters (email, name, class year) used to
 * recognize a real student and to mint personalized review-invite links.
 *
 * Holds bulk PII for people who do not have Proximity accounts, so RLS is
 * enabled with NO policies: only the service-role key can read it. Nothing
 * here is ever reachable from the browser's publishable key.
 *
 * token_hash is the SHA-256 of the invite token, never the token itself — a
 * dump of this table cannot be replayed into review links.
 */
create table if not exists public.student_roster (
  id          uuid primary key default gen_random_uuid(),
  email       text        not null,
  first_name  text,
  last_name   text,
  class_year  smallint,
  token_hash  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Email is the identity here: one row per address, matched case-insensitively
-- so a roster file with mixed casing can't create duplicates.
create unique index if not exists student_roster_email_key
  on public.student_roster (lower(email));

-- Invite lookups arrive as a hash and must resolve to exactly one student.
create unique index if not exists student_roster_token_hash_key
  on public.student_roster (token_hash)
  where token_hash is not null;

create index if not exists student_roster_class_year_idx
  on public.student_roster (class_year);

alter table public.student_roster enable row level security;
