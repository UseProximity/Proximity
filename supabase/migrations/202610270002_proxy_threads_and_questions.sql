-- Per-listing agents, milestone 2: Proxy threads and question routing
-- (Wyatt, PRD v3, 2026-10-26).
--
-- Proxy is the go-between. A student (or a signed-out visitor) talks to Proxy
-- in a thread of its own, one per listing per person, and no landlord is ever
-- in it. What Proxy cannot answer becomes a question row routed to the owner
-- of the lease the student picked; the landlord answers Proxy, and Proxy
-- relays the answer to every thread waiting on that question.
--
--   thread_types 'proxy'          the Proxy thread. Listed by no inbox: the
--                                 inbox RPC only shows 'direct' threads.
--   users 'Proxy'                 the system sender of Proxy's messages
--                                 (is_system, so no routing ever picks it as
--                                 a landlord).
--   chat_threads.visitor_id       the prx_vid cookie of a signed-out visitor's
--                                 thread (interested_user_id stays NULL until
--                                 they sign in and claim it).
--   chat_threads.notify_email     an email a signed-out visitor leaves to hear
--                                 back. Never shown to the landlord.
--   chat_threads.unrestricted     a tour thread (milestone 5): contact details
--                                 and links allowed.
--   chat_threads.proxy_state      Proxy's running notes on the thread: how
--                                 many exchanges, when it last nudged.
--   chat_messages.message_type    widened: proxy_answer (from facts),
--                                 proxy_asked (sent to the landlord),
--                                 proxy_relay (the landlord's answer, relayed),
--                                 proxy_note (updates, no-answer notes).
--   listing_questions             one open question per listing, routed to
--                                 one landlord; dedup means several students
--                                 wait on one row.
--   listing_question_waiters      the threads (students) waiting on it.
--   listing_question_messages     the clarifier exchange and the answer.
--   listing_agent_questions       the audit log: every student message Proxy
--                                 handled, what it answered from and how.
--
-- Service role only. Idempotent. Apply to BOTH dev and prod.

insert into public.thread_types (name)
select 'proxy' where not exists (select 1 from public.thread_types where name = 'proxy');

-- The Proxy sender. Fixed id so code can name it without a lookup.
insert into public.users (id, email, name, role_id, is_system, email_verified, google_account, email_notifications)
select '00000000-0000-0000-0000-000000000010', 'proxy@useproximity.org', 'Proxy',
       (select id from public.roles where name = 'system' limit 1), true, true, false, false
where not exists (select 1 from public.users where id = '00000000-0000-0000-0000-000000000010')
  and exists (select 1 from public.roles where name = 'system');

alter table public.chat_threads add column if not exists visitor_id uuid;
alter table public.chat_threads add column if not exists notify_email text;
alter table public.chat_threads add column if not exists unrestricted boolean not null default false;
alter table public.chat_threads add column if not exists proxy_state jsonb not null default '{}'::jsonb;
create index if not exists chat_threads_visitor_listing_idx
  on public.chat_threads (visitor_id, listing_id) where visitor_id is not null and deleted_at is null;
create index if not exists chat_threads_student_listing_idx
  on public.chat_threads (interested_user_id, listing_id) where deleted_at is null;

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'chat_messages_message_type_check' and conrelid = 'public.chat_messages'::regclass
  ) then
    alter table public.chat_messages drop constraint chat_messages_message_type_check;
  end if;
  alter table public.chat_messages add constraint chat_messages_message_type_check
    check (message_type in ('text', 'attachment', 'proxy_answer', 'proxy_asked', 'proxy_relay', 'proxy_note'));
end $$;

create table if not exists public.listing_questions (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  lease_id uuid references public.unit_leases(id) on delete set null,
  -- The landlord asked. NULL when the listing has nobody to ask (no owner and
  -- no contact email): the question waits for whoever claims the listing.
  owner_id uuid references public.users(id) on delete set null,
  status text not null default 'open' check (status in ('open', 'answered', 'closed', 'unroutable')),
  question text not null,
  -- Lower-cased, punctuation-stripped form, for exact-match dedup before the
  -- model is asked whether two questions are the same.
  normalized text not null,
  section text,
  -- The one line a landlord sees about who asked: "about the 2-bed, 12-month
  -- lease, signed in". Never a name.
  context text,
  asked_count integer not null default 1,
  first_thread_id uuid references public.chat_threads(id) on delete set null,
  answer text,
  answered_by uuid references public.users(id) on delete set null,
  answered_at timestamptz,
  closed_at timestamptz,
  -- True while a clarifying question from the landlord waits for the student.
  pending_clarifier boolean not null default false,
  reminder_1_at timestamptz,
  reminder_3_at timestamptz,
  student_told_at timestamptz,
  last_activity_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.listing_questions enable row level security;
create index if not exists listing_questions_listing_open_idx
  on public.listing_questions (listing_id, created_at desc) where status = 'open';
create index if not exists listing_questions_owner_open_idx
  on public.listing_questions (owner_id, created_at desc) where status = 'open';
create index if not exists listing_questions_listing_idx
  on public.listing_questions (listing_id, created_at desc);

create table if not exists public.listing_question_waiters (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.listing_questions(id) on delete cascade,
  thread_id uuid not null references public.chat_threads(id) on delete cascade,
  message_id uuid references public.chat_messages(id) on delete set null,
  user_id uuid references public.users(id) on delete set null,
  visitor_id uuid,
  relayed_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.listing_question_waiters enable row level security;
create unique index if not exists listing_question_waiters_uq
  on public.listing_question_waiters (question_id, thread_id);
create index if not exists listing_question_waiters_thread_idx
  on public.listing_question_waiters (thread_id);

create table if not exists public.listing_question_messages (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.listing_questions(id) on delete cascade,
  sender text not null check (sender in ('landlord', 'student', 'proxy')),
  -- For a student's reply: which thread it came from.
  thread_id uuid references public.chat_threads(id) on delete set null,
  user_id uuid references public.users(id) on delete set null,
  body text not null,
  -- The body as the landlord wrote it, before contact details were removed.
  -- Kept for the audit trail; never shown to a student.
  raw_body text,
  screened boolean not null default false,
  via text not null default 'app' check (via in ('app', 'email')),
  created_at timestamptz not null default now()
);
alter table public.listing_question_messages enable row level security;
create index if not exists listing_question_messages_question_idx
  on public.listing_question_messages (question_id, created_at);

create table if not exists public.listing_agent_questions (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  thread_id uuid references public.chat_threads(id) on delete set null,
  message_id uuid references public.chat_messages(id) on delete set null,
  user_id uuid references public.users(id) on delete set null,
  visitor_id uuid,
  question text not null,
  answer text,
  fact_keys text[] not null default '{}',
  outcome text not null check (outcome in (
    'answered', 'asked_landlord', 'partly_answered', 'chit_chat', 'tour', 'unavailable', 'declined', 'failed', 'test'
  )),
  question_id uuid references public.listing_questions(id) on delete set null,
  model text,
  latency_ms integer,
  -- Counted as an inquiry for the listing (not test mode).
  inquiry boolean not null default true,
  reported_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.listing_agent_questions enable row level security;
create index if not exists listing_agent_questions_listing_idx
  on public.listing_agent_questions (listing_id, created_at desc);
create index if not exists listing_agent_questions_thread_idx
  on public.listing_agent_questions (thread_id, created_at);

do $$
declare t text;
begin
  foreach t in array array['listing_questions']
  loop
    if not exists (
      select 1 from pg_trigger
      where tgname = 'trg_set_updated_at_' || t and tgrelid = ('public.' || t)::regclass
    ) then
      execute format(
        'create trigger trg_set_updated_at_%I before update on public.%I for each row execute function fn_set_updated_at()',
        t, t
      );
    end if;
  end loop;
end $$;
