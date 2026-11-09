-- When the billing run announced an invoice: autopay scheduled and the invoice
-- email sent (review of 2026-11-07). A run cut short after Stripe finalized an
-- invoice used to leave it un-emailed for good; the next run (or the daily
-- follow-up) now finishes any open invoice with no announced_at.
--
-- Non-destructive: one nullable column; invoices already sent are stamped with
-- their send time so nothing is announced twice.

ALTER TABLE public.billing_invoices ADD COLUMN IF NOT EXISTS announced_at timestamptz;

UPDATE public.billing_invoices
   SET announced_at = COALESCE(sent_at, invoice_date::timestamptz)
 WHERE announced_at IS NULL
   AND stripe_invoice_id IS NOT NULL
   AND invoice_date IS NOT NULL;

COMMENT ON COLUMN public.billing_invoices.announced_at IS
  'When the billing run scheduled autopay and emailed this invoice. Null on an open, issued invoice means a run stopped before telling the landlord; the next run finishes it.';
