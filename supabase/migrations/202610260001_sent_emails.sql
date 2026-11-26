-- Every email the app sends, for the admin "Sent emails" page (Wyatt, 2026-10-24).
--
-- Chat emails already had chat_email_log, but password resets, verification,
-- review invites, landlord nudges, team alerts and the rest left no trace, and
-- none of them show in the info@ Gmail Sent folder because they go out through
-- Amazon SES. sendMailSafe (apps/web/src/lib/outreach.js) is the one function
-- every email passes through, and it now writes a row here for each attempt.
--
--   category / kind  what the email is: category groups the page's tabs
--                    ('chat', 'account', 'reviews', 'landlords', 'team',
--                    'other'); kind is the specific email ('password_reset',
--                    'chat_alert'). Labels live in lib/emailLog.js.
--   to_email, cc     the real recipient, even off production where the email
--                    was redirected to a test inbox or not sent at all.
--   redirected_to    off production: the test inbox it went to instead.
--   subject          as sent, without the off-production "[TEST ...]" prefix.
--   body_html,       the email as sent, with every login, setup, reset and
--   body_text        invite token in its links replaced by [removed]. Storing
--                    them raw would put working account links in a table the
--                    admin panel reads (the leak 202610230002 closed).
--   provider         'ses' or 'gmail' (the fallback). NULL when not sent.
--   provider_message_id  SES's MessageId, which /api/ses/events matches.
--   status           'sent'       accepted by SES or Gmail, no outcome yet.
--                                 Gmail never reports one, so it stays here.
--                    'delivered'  the recipient's mail server accepted it
--                    'delayed'    their server is deferring it; SES retries
--                    'bounced'    permanently refused
--                    'complained' the recipient marked it as spam
--                    'rejected'   SES refused to send it
--                    'failed'     the send raised an error
--                    'suppressed' off production with no test inbox: not sent
--   status_detail    the provider's wording for the last event, or the error.
--   thread_id,       context when the sender knows it (chat emails), so the
--   user_id          page can link to the conversation or account.
--
-- Rows from chat_email_log are copied in once (same ids, no subject or body,
-- which were never kept) so the page's history starts on Oct 13, not today.
-- chat_email_log stays: the chat delivery audit and reply threading read it.
--
-- Service role only. Idempotent. Apply to BOTH dev and prod.

CREATE TABLE IF NOT EXISTS public.sent_emails (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  category            text NOT NULL DEFAULT 'other' CHECK (category IN ('chat', 'account', 'reviews', 'landlords', 'team', 'other')),
  kind                text NOT NULL DEFAULT 'other',
  to_email            text,
  cc                  text,
  redirected_to       text,
  from_email          text,
  subject             text,
  body_html           text,
  body_text           text,
  provider            text CHECK (provider IN ('ses', 'gmail')),
  provider_message_id text,
  status              text NOT NULL DEFAULT 'sent' CHECK (status IN (
    'sent', 'delivered', 'delayed', 'bounced', 'complained', 'rejected', 'failed', 'suppressed'
  )),
  status_detail       text,
  status_at           timestamptz,
  delivered_at        timestamptz,
  thread_id           uuid,
  user_id             uuid
);

ALTER TABLE public.sent_emails ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sent_emails FROM anon, authenticated;

CREATE INDEX IF NOT EXISTS idx_sent_emails_created ON public.sent_emails (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sent_emails_category ON public.sent_emails (category, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sent_emails_status ON public.sent_emails (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sent_emails_provider_id
  ON public.sent_emails (provider_message_id) WHERE provider_message_id IS NOT NULL;

INSERT INTO public.sent_emails (
  id, created_at, category, kind, to_email, provider, provider_message_id,
  status, status_detail, status_at, delivered_at, thread_id, user_id
)
SELECT
  l.id, l.created_at, 'chat',
  CASE l.kind WHEN 'reminder' THEN 'chat_reminder' ELSE 'chat_alert' END,
  l.to_email, l.provider, l.provider_message_id,
  l.status, l.status_detail, l.status_at, l.delivered_at, l.thread_id, l.recipient_id
FROM public.chat_email_log l
-- Safe to re-run after the app has started logging: a chat email sendMailSafe
-- already recorded (same recipient, within two minutes) is not copied again.
WHERE NOT EXISTS (
  SELECT 1 FROM public.sent_emails s
   WHERE s.category = 'chat'
     AND s.to_email IS NOT DISTINCT FROM l.to_email
     AND s.created_at BETWEEN l.created_at - interval '2 minutes' AND l.created_at + interval '2 minutes'
)
ON CONFLICT (id) DO NOTHING;
