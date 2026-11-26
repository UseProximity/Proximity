-- Delivery tracking for chat emails (Wyatt, 2026-10-23).
--
-- chat_email_log had one row per alert SES or Gmail accepted, and nothing
-- else: an alert that failed to send left no row, and nobody could tell
-- whether an accepted one ever reached the recipient's mail server. Now every
-- attempt gets a row, and SES events (/api/ses/events) move it along:
--
--   kind           'alert' (a new message) or 'reminder' (the 3 day nudge).
--   message_id     the chat message that triggered the alert. NULL for
--                  reminders and for rows from before this migration. Not a
--                  foreign key: chat-retention purges old messages, and the
--                  delivery record should outlive them.
--   status         'sent'       accepted by SES or Gmail, no outcome yet
--                  'delivered'  the recipient's mail server accepted it (SES)
--                  'delayed'    the recipient's server is deferring it; SES
--                               keeps retrying
--                  'bounced'    permanently refused; the address is suppressed
--                  'complained' the recipient marked it as spam
--                  'rejected'   SES refused to send it (virus, suppression)
--                  'failed'     never sent: both SES and Gmail failed, or the
--                               message could not be built
--   status_detail  the provider's wording for the last event, or the error.
--   status_at      when the status last changed.
--   delivered_at   when SES reported delivery.
--
-- Gmail sends (the fallback when SES is down) have no delivery events and stay
-- 'sent'; the daily check-in lists them as unconfirmed.
--
-- Idempotent. Apply to BOTH dev and prod.

ALTER TABLE public.chat_email_log
  ADD COLUMN IF NOT EXISTS kind          text NOT NULL DEFAULT 'alert',
  ADD COLUMN IF NOT EXISTS message_id    uuid,
  ADD COLUMN IF NOT EXISTS status        text NOT NULL DEFAULT 'sent',
  ADD COLUMN IF NOT EXISTS status_detail text,
  ADD COLUMN IF NOT EXISTS status_at     timestamptz,
  ADD COLUMN IF NOT EXISTS delivered_at  timestamptz;

-- A failed attempt has no provider message id, and may have no provider.
ALTER TABLE public.chat_email_log ALTER COLUMN provider DROP NOT NULL;

DO $$ BEGIN
  ALTER TABLE public.chat_email_log
    ADD CONSTRAINT chat_email_log_kind_check CHECK (kind IN ('alert', 'reminder'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.chat_email_log
    ADD CONSTRAINT chat_email_log_status_check CHECK (status IN (
      'sent', 'delivered', 'delayed', 'bounced', 'complained', 'rejected', 'failed'
    ));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- The daily check-in looks for rows that never reached 'delivered'.
CREATE INDEX IF NOT EXISTS idx_chat_email_log_status
  ON public.chat_email_log (status, created_at DESC);
