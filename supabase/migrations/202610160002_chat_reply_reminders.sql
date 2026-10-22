-- Reply reminders (Wyatt, 2026-10-16).
--
-- The daily chat check-in (/api/cron/chat-checkin) already records every
-- silence it reports to the team in chat_checkin_alerts, one row per
-- unanswered message. The same run now also emails the person who went quiet,
-- once, a reminder that the other side is waiting. These columns record what
-- happened to that reminder on the alert row itself, so the weekly report can
-- see whether a reminded side came back.
--
--   reminder_status   'sent', or why it was not: 'too_old' (silence older than
--                     the reminder window, e.g. the backlog on the first run),
--                     'listing_unavailable', 'blocked', 'no_recipient' (opted
--                     out, suppressed or no email), 'suppressed' (off
--                     production), 'failed'. NULL on rows from before this
--                     migration.
--   reminder_sent_at  when the reminder email went out.
--
-- Apply to BOTH dev and prod.

ALTER TABLE public.chat_checkin_alerts
  ADD COLUMN IF NOT EXISTS reminder_status  text,
  ADD COLUMN IF NOT EXISTS reminder_sent_at timestamptz;

DO $$ BEGIN
  ALTER TABLE public.chat_checkin_alerts
    ADD CONSTRAINT chat_checkin_alerts_reminder_status_check
    CHECK (reminder_status IS NULL OR reminder_status IN (
      'sent', 'too_old', 'listing_unavailable', 'blocked', 'no_recipient', 'suppressed', 'failed'
    ));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
