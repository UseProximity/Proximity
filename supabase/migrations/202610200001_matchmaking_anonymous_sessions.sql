-- Matchmaking before login (Wyatt, 2026-10-20).
--
-- A signed-out visitor can now run the whole Proxy chat. Their session row has
-- no user yet: it is keyed by visitor_id, the prx_vid device cookie that the
-- waitlist feature already sets, and the recommendations stay locked until they
-- create an account or log in. On the first signed-in request from that device
-- the chat route stamps user_id onto every unclaimed row for the cookie (the
-- "claim"), after which the row is an ordinary signed-in session.
--
-- visitor_id is only ever written on sessions that STARTED signed out. It is
-- what the three-chats-per-device cap counts, so signed-in chats must not carry
-- it. Rows that are still unclaimed 30 days after creation are deleted by the
-- purge-accounts cron.
--
-- Apply to BOTH dev and prod.

ALTER TABLE public.matchmaking_chat_sessions
  ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE public.matchmaking_chat_sessions
  ADD COLUMN IF NOT EXISTS visitor_id uuid;

-- Every session belongs to someone: an account, a device, or (after a claim) both.
ALTER TABLE public.matchmaking_chat_sessions
  DROP CONSTRAINT IF EXISTS matchmaking_chat_sessions_owner_check;
ALTER TABLE public.matchmaking_chat_sessions
  ADD CONSTRAINT matchmaking_chat_sessions_owner_check
  CHECK (user_id IS NOT NULL OR visitor_id IS NOT NULL);

-- The cap count, the per-device resume and the claim all look up by cookie.
CREATE INDEX IF NOT EXISTS matchmaking_chat_sessions_visitor_idx
  ON public.matchmaking_chat_sessions (visitor_id)
  WHERE visitor_id IS NOT NULL;
