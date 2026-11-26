-- Per-listing agents, milestone 5: tour scheduling (Wyatt, 2026-10-26).
--
-- Booking a tour is the one thing that reaches a landlord as a person, and
-- where contact details are exchanged.
--
--   student_availability   a student's weekly pattern: which hour blocks on
--                          which weekdays they can tour (America/Chicago).
--                          Set once, reused for every request.
--   tour_requests          one request per student per lease: the real-date
--                          slots the student offered (from the pattern, next
--                          14 days, unticked ones removed), the landlord's
--                          counter-proposals, the confirmed slot, and the
--                          contact details each side received on
--                          confirmation. thread_id is the in-app thread
--                          opened on confirmation (chat_threads.unrestricted
--                          = true: contact details and links allowed there).
--
-- Service role only. Idempotent. Apply to BOTH dev and prod.

create table if not exists public.student_availability (
  user_id uuid primary key references public.users(id) on delete cascade,
  -- { "mon": [9, 10, 14], "tue": [], ... } hour blocks, 8 to 19, Chicago time.
  pattern jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.student_availability enable row level security;

create table if not exists public.tour_requests (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  lease_id uuid references public.unit_leases(id) on delete set null,
  student_id uuid not null references public.users(id) on delete cascade,
  -- The landlord who owns the lease (else the primary owner, else the
  -- listing's contact placeholder). NULL = nobody to ask.
  landlord_id uuid references public.users(id) on delete set null,
  status text not null default 'requested' check (status in (
    'requested', 'proposed', 'confirmed', 'cancelled', 'expired'
  )),
  -- ISO timestamps (UTC) of one-hour slots.
  student_slots jsonb not null default '[]'::jsonb,
  landlord_slots jsonb not null default '[]'::jsonb,
  confirmed_slot timestamptz,
  confirmed_by uuid references public.users(id) on delete set null,
  confirmed_at timestamptz,
  -- What each side was given on confirmation: { name, email, phone }.
  student_contact jsonb,
  landlord_contact jsonb,
  student_phone text,
  proxy_thread_id uuid references public.chat_threads(id) on delete set null,
  thread_id uuid references public.chat_threads(id) on delete set null,
  cancelled_by uuid references public.users(id) on delete set null,
  cancel_reason text,
  reminder_1_at timestamptz,
  reminder_3_at timestamptz,
  student_told_at timestamptz,
  day_before_reminded_at timestamptz,
  last_activity_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.tour_requests enable row level security;
create index if not exists tour_requests_student_idx on public.tour_requests (student_id, created_at desc);
create index if not exists tour_requests_landlord_open_idx
  on public.tour_requests (landlord_id, created_at desc) where status in ('requested', 'proposed');
create index if not exists tour_requests_listing_idx on public.tour_requests (listing_id, created_at desc);
create index if not exists tour_requests_confirmed_idx
  on public.tour_requests (confirmed_slot) where status = 'confirmed';
-- One open request per student per lease.
create unique index if not exists tour_requests_open_uq
  on public.tour_requests (student_id, coalesce(lease_id, listing_id))
  where status in ('requested', 'proposed');

do $$
declare t text;
begin
  foreach t in array array['student_availability', 'tour_requests']
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
