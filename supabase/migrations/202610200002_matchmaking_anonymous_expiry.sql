-- Expire signed-out chats instead of deleting them (Wyatt, 2026-10-20).
--
-- An unclaimed signed-out chat past its 30-day claim window used to be deleted
-- by the purge-accounts cron. Claimed ones were kept, so for any period older
-- than 30 days the dashboard saw only the claimed chats and the signed-out
-- conversion rate read close to 100%. The cron now blanks the row instead:
-- transcript, preferences, weights, candidates and recommendations are emptied
-- and visitor_id is cleared, so nothing ties it to a browser or to what was
-- said. The id, created_at and status stay for the counts.
--
-- A blanked row has neither user_id nor visitor_id, so the owner check allows
-- that only when the row is marked expired.
--
-- Apply to BOTH dev and prod.

ALTER TABLE public.matchmaking_chat_sessions
  ADD COLUMN IF NOT EXISTS expired_at timestamptz;

ALTER TABLE public.matchmaking_chat_sessions
  DROP CONSTRAINT IF EXISTS matchmaking_chat_sessions_owner_check;
ALTER TABLE public.matchmaking_chat_sessions
  ADD CONSTRAINT matchmaking_chat_sessions_owner_check
  CHECK (user_id IS NOT NULL OR visitor_id IS NOT NULL OR expired_at IS NOT NULL);
