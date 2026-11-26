-- Per-listing agents, milestone 3: landlords answer Proxy's questions by
-- email (PRD v3, "Learning from landlord answers").
--
-- Each question email carries its own Reply-To, reply+q<token>@<reply
-- domain>, where the token is an HMAC of the question and the landlord under
-- CHAT_REPLY_SECRET (lib/agents/questionEmail.js). Only its SHA-256 is stored
-- here, which is what an inbound reply is looked up by; the sender must still
-- be the landlord's own address or an approved reply sender.
--
-- Idempotent. Apply to BOTH dev and prod.

alter table public.listing_questions add column if not exists reply_token_hash text;
create unique index if not exists listing_questions_reply_token_hash_uq
  on public.listing_questions (reply_token_hash) where reply_token_hash is not null;
