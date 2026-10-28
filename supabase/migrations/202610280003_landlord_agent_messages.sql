-- One chat per listing for the landlord (Wyatt, 2026-10-28, round 7): the
-- landlord's conversation with the listing's agent is saved, so it reads as
-- one thread with the students' questions and tour requests in the Agent
-- tab, the Questions tab and Messages. One thread per landlord per listing.
--
-- A landlord message that Proxy matched to an open question records it in
-- question_id (the answer itself lives in listing_question_messages). An
-- agent message can carry a proposal (the diff the landlord confirms) and
-- what became of it.

create table if not exists public.landlord_agent_messages (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  landlord_id uuid not null references public.users(id) on delete cascade,
  sender text not null check (sender in ('landlord', 'agent')),
  body text not null,
  question_id uuid references public.listing_questions(id) on delete set null,
  proposal jsonb,
  proposal_status text check (proposal_status in ('open', 'applied', 'cancelled')),
  created_at timestamptz not null default now()
);
alter table public.landlord_agent_messages enable row level security;
create index if not exists landlord_agent_messages_listing_idx
  on public.landlord_agent_messages (landlord_id, listing_id, created_at);
