-- Approved reply senders (Wyatt, 2026-10-24).
--
-- An emailed reply is only posted when it comes from the landlord's account
-- email, the alert address the conversation emails, or the same company domain.
-- Leasing teams often answer from someone else's mailbox (a shared inbox read
-- on a colleague's phone, a property manager at another company), and those
-- replies were refused. Now the landlord, or the Proximity team, can approve
-- another address or a whole company domain to reply on the landlord's behalf.
--
--   landlord_reply_senders  one row per landlord and address or domain:
--     pattern      'vic@revivalstl.com' (one address) or '@revivalstl.com'
--                  (anyone at that domain). Lower case. Free mail domains
--                  are refused as domains by the app, never stored.
--     decision     'approved', or 'declined' ("not them": no more prompts
--                  about that address, its replies stay refused).
--     decided_by   who decided; decided_via 'landlord' or 'admin'.
--
-- chat_inbound_emails gains:
--   status 'held'            refused only because the sender is not approved
--                            yet; the landlord has been asked. Approving re-runs
--                            it. Declining turns it into 'wrong_sender'.
--   body_preview             what the held reply says, so the landlord can see
--                            it before deciding (the raw email stays in S3).
--   sender_name              the display name on the From line.
--   approval_requested_at    when the landlord was emailed about this sender.
--                            One email per sender per landlord until decided.
--
-- Idempotent. Apply to BOTH dev and prod.

CREATE TABLE IF NOT EXISTS public.landlord_reply_senders (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  landlord_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  pattern     text NOT NULL CHECK (
    pattern = lower(btrim(pattern))
    AND (pattern ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' OR pattern ~ '^@[^@\s]+\.[^@\s]+$')
  ),
  decision    text NOT NULL CHECK (decision IN ('approved', 'declined')),
  decided_by  uuid REFERENCES public.users(id) ON DELETE SET NULL,
  decided_via text NOT NULL CHECK (decided_via IN ('landlord', 'admin')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (landlord_id, pattern)
);

ALTER TABLE public.landlord_reply_senders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.landlord_reply_senders FROM anon, authenticated;

ALTER TABLE public.chat_inbound_emails
  ADD COLUMN IF NOT EXISTS body_preview          text,
  ADD COLUMN IF NOT EXISTS sender_name           text,
  ADD COLUMN IF NOT EXISTS approval_requested_at timestamptz;

ALTER TABLE public.chat_inbound_emails DROP CONSTRAINT IF EXISTS chat_inbound_emails_status_check;
ALTER TABLE public.chat_inbound_emails ADD CONSTRAINT chat_inbound_emails_status_check CHECK (status IN (
  'processing', 'posted', 'spam', 'auto_reply', 'unauthenticated', 'unknown_address',
  'wrong_sender', 'held', 'empty', 'rejected', 'error'
));

-- Held replies are looked up per landlord and sender.
CREATE INDEX IF NOT EXISTS idx_chat_inbound_emails_held
  ON public.chat_inbound_emails (user_id, from_email)
  WHERE status = 'held';
