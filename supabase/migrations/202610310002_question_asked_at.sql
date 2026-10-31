-- When the landlord's turn on a question last started (PR #365 review).
-- Reminders (day 1 and 3) and the day-5 note to students were timed from
-- created_at, so a question reopened by a student's follow-up fired them
-- within the hour. asked_at is reset whenever the question comes back to the
-- landlord (a follow-up, or the student's reply to the landlord's clarifying
-- question), together with the reminder stamps.

alter table public.listing_questions
  add column if not exists asked_at timestamptz;
update public.listing_questions set asked_at = created_at where asked_at is null;
alter table public.listing_questions
  alter column asked_at set default now(),
  alter column asked_at set not null;
create index if not exists listing_questions_open_asked_idx
  on public.listing_questions (asked_at) where status = 'open';
