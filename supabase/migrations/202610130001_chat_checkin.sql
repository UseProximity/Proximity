-- Internal chat check-in (Wyatt, 2026-10-13).
--
-- Two cron jobs watch landlord and student conversations for the team:
--   /api/cron/chat-checkin         daily: a thread where one side has not
--                                  answered in 3 days is emailed to the team.
--   /api/cron/chat-checkin-report  weekly: how the daily job performed, plus
--                                  an AI read of where conversations lead.
--
-- chat_checkin_alerts records every thread the daily job emailed about, keyed
-- on the message that was waiting for a reply. A thread is alerted ONCE per
-- silence: the same unanswered message is never sent twice, but a new message
-- that then goes unanswered for 3 days is. The weekly report reads this table
-- to count alerts by side and to see whether the quiet side came back.
--
-- chat_checkin_runs is the job log: one row per cron run, success or failure,
-- with the counts the run produced. The weekly report summarises it.
--
-- Apply to BOTH dev and prod.

CREATE TABLE IF NOT EXISTS public.chat_checkin_alerts (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id       uuid        NOT NULL REFERENCES public.chat_threads(id) ON DELETE CASCADE,
  last_message_id uuid        NOT NULL REFERENCES public.chat_messages(id) ON DELETE CASCADE,
  quiet_side      text        NOT NULL CHECK (quiet_side IN ('landlord', 'student')),
  silent_since    timestamptz NOT NULL,
  sent_at         timestamptz NOT NULL DEFAULT now(),
  recipients      text[]      NOT NULL DEFAULT '{}',
  dry_run         boolean     NOT NULL DEFAULT false
);

-- One real alert per unanswered message. Dry runs are logged but never block.
CREATE UNIQUE INDEX IF NOT EXISTS chat_checkin_alerts_once_per_silence
  ON public.chat_checkin_alerts (thread_id, last_message_id)
  WHERE dry_run = false;

CREATE INDEX IF NOT EXISTS chat_checkin_alerts_sent_at_idx
  ON public.chat_checkin_alerts (sent_at);

CREATE TABLE IF NOT EXISTS public.chat_checkin_runs (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        text        NOT NULL CHECK (kind IN ('checkin', 'report')),
  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  ok          boolean     NOT NULL DEFAULT false,
  dry_run     boolean     NOT NULL DEFAULT false,
  stats       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  error       text
);

CREATE INDEX IF NOT EXISTS chat_checkin_runs_started_at_idx
  ON public.chat_checkin_runs (kind, started_at);

ALTER TABLE public.chat_checkin_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_checkin_runs   ENABLE ROW LEVEL SECURITY;
-- No policies: internal tables, read and written by the service role only.
