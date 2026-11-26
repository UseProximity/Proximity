-- Chat: reports.
--
-- Adds only chat_reports, a plain queue to be read by hand, like review_reports:
-- server side only, RLS on with no policies.
--
-- Blocking needs no schema change. It reuses user_blocks (the same table reviews
-- read) and is enforced in the chat API routes (apps/web/src/lib/chat/safety.js),
-- so no existing chat RPC, policy, grant or function is touched by this migration.
--
-- Idempotent / safe to re-run. Apply to BOTH dev and prod.

CREATE TABLE IF NOT EXISTS public.chat_reports (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id      uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  reported_user_id uuid        REFERENCES public.users(id) ON DELETE SET NULL,
  thread_id        uuid        NOT NULL REFERENCES public.chat_threads(id) ON DELETE CASCADE,
  message_id       uuid        REFERENCES public.chat_messages(id) ON DELETE SET NULL,
  reason           text        NOT NULL,
  message_excerpt  text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  reviewed_at      timestamptz,
  CONSTRAINT chat_reports_reason_check
    CHECK (reason IN ('harassment', 'scam_or_fraud', 'spam', 'inappropriate_content', 'other')),
  CONSTRAINT chat_reports_excerpt_length_check
    CHECK (message_excerpt IS NULL OR char_length(message_excerpt) <= 500)
);

-- One report per reporter per message; a whole-conversation report (no message)
-- counts once per thread.
CREATE UNIQUE INDEX IF NOT EXISTS chat_reports_one_per_reporter
  ON public.chat_reports (
    reporter_id,
    thread_id,
    COALESCE(message_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

CREATE INDEX IF NOT EXISTS idx_chat_reports_pending
  ON public.chat_reports (created_at DESC)
  WHERE reviewed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_chat_reports_reported_user
  ON public.chat_reports (reported_user_id);

-- Server-only, like every other chat table: RLS on, no policies.
ALTER TABLE public.chat_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.chat_reports FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON public.chat_reports FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON public.chat_reports FROM authenticated;
  END IF;
END $$;

DO $$ BEGIN
  RAISE NOTICE 'Migration 202610090001: chat_reports added.';
END $$;
