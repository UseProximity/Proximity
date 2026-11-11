-- Unsubscribing from mass email (Wyatt, 2026-11-08).
--
-- ── mass_email_unsubscribes ─────────────────────────────────────────────────
-- Addresses that clicked the unsubscribe link in a mass email footer, or the
-- Gmail / Yahoo "Unsubscribe" button (List-Unsubscribe one-click). sendBatch
-- skips them. Resubscribing deletes the row.
--   source  link (the footer link's page) | one_click (the mail client's button)
--
-- Separate from email_suppressions on purpose: that table also stops chat alerts
-- (fn_email_suppressed), and leaving announcements must not stop someone's own
-- messages, password resets or invoices.
--
-- Server-side only (service role). Idempotent. Apply to BOTH dev and prod.

CREATE TABLE IF NOT EXISTS public.mass_email_unsubscribes (
  email       text PRIMARY KEY CHECK (email = lower(btrim(email)) AND position('@' IN email) > 1),
  source      text NOT NULL DEFAULT 'link' CHECK (source IN ('link', 'one_click')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.mass_email_unsubscribes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mass_email_unsubscribes FROM anon, authenticated;
