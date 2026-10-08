-- Chat: index the column the rate limiter filters on.
--
-- fn_chat_assert_send_rate runs three counts per send, all shaped
-- "WHERE sender_id = $1 AND created_at > now() - interval". chat_messages had
-- indexes on (thread_id, created_at) and on listing_id, but nothing on
-- sender_id, so each of those counts was a sequential scan over every message
-- in the table. Fine at today's volume, quadratic-feeling the moment chat gets
-- real traffic, and it sits in the hot path of every single send.
--
-- Not partial: the rate limit counts include soft-deleted messages on purpose,
-- so a WHERE deleted_at IS NULL index could never serve them (see 202610070003).
--
-- Idempotent. Apply to BOTH dev and prod.

CREATE INDEX IF NOT EXISTS idx_chat_messages_sender_recent
  ON public.chat_messages (sender_id, created_at DESC);

DO $$ BEGIN
  RAISE NOTICE 'Migration 202610070002: chat_messages(sender_id, created_at) index for the send rate limiter.';
END $$;
