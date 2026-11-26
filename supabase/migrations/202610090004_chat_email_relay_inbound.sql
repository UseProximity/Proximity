-- Chat: inbound half of reply-by-email.
--
-- SES receives mail for reply+<token>@reply(-staging|-dev).useproximity.org,
-- stores the raw message in S3 and (on prod and staging) tells the app over
-- SNS. The app reads it, checks it, and posts the cleaned-up text into the
-- conversation as the person the token belongs to.
--
-- chat_inbound_emails records every message received and what became of it,
-- whether it was posted or dropped. It is also:
--   the dedupe key   s3_key is unique, so an SNS retry or a manual re-run never
--                    posts the same reply twice;
--   the notice limit a "your reply was not delivered" email goes out at most
--                    once per sender per thread per 24 hours (notice_sent_at).
--
-- The message text itself lives in chat_messages like any other message. This
-- table never holds a body, only the outcome.
--
-- Idempotent. Apply to BOTH dev and prod.

CREATE TABLE IF NOT EXISTS public.chat_inbound_emails (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  s3_key            text NOT NULL UNIQUE,
  message_id_header text,
  from_email        text,
  to_address        text,
  thread_id         uuid REFERENCES public.chat_threads(id) ON DELETE SET NULL,
  user_id           uuid REFERENCES public.users(id) ON DELETE SET NULL,
  status            text NOT NULL CHECK (status IN (
                      'processing',  -- claimed, not finished (a crash leaves it here)
                      'posted',      -- landed in the conversation
                      'spam',        -- SES spam or virus verdict
                      'auto_reply',  -- out of office, bounce, mailing list
                      'unauthenticated', -- failed SPF/DKIM/DMARC for the From domain
                      'unknown_address', -- no participant has this reply address
                      'wrong_sender',    -- From is not the participant (incl. forwards)
                      'empty',       -- nothing left after removing quotes and signature
                      'rejected',    -- conversation gone, or the send RPC refused it
                      'error'
                    )),
  reason            text,
  chat_message_id   uuid REFERENCES public.chat_messages(id) ON DELETE SET NULL,
  notice_sent_at    timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_inbound_emails_notice
  ON public.chat_inbound_emails (from_email, thread_id, notice_sent_at)
  WHERE notice_sent_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_chat_inbound_emails_message_id
  ON public.chat_inbound_emails (message_id_header)
  WHERE message_id_header IS NOT NULL;

ALTER TABLE public.chat_inbound_emails ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.chat_inbound_emails FROM anon, authenticated;
