-- Question cards in the landlord's chat (Wyatt, 2026-10-29): each question is
-- one card holding its whole back-and-forth. A student who follows up on a
-- question they already asked reopens that card instead of starting a new
-- one, so a student message is either a reply to the landlord's question
-- back ('reply') or a new follow-up from the student ('followup'). Older
-- rows stay null and read as replies.

alter table public.listing_question_messages
  add column if not exists kind text check (kind in ('reply', 'followup'));

-- Tour cards get a Reply too: what the landlord writes there goes to the
-- student in their direct chat, and a copy stays on the card.
alter table public.landlord_agent_messages
  add column if not exists tour_id uuid references public.tour_requests(id) on delete set null;
