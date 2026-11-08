-- Two guards from the PR #370 review (In-App Payments).
--
-- 1. billing_invoices.invoice_date is now the date Stripe finalized the invoice,
--    and stays NULL until then. It used to default to the moment the local row
--    was written, which is before anything exists in Stripe. A run that crashed
--    between the two left an "open" row nobody could pay, and 30 days later the
--    overdue job withdrew the landlord's leases over it. The overdue clock and
--    every "Invoiced on" date now start from a real, issued invoice.
--
-- 2. A lease the overdue job withdrew stays off the market until an admin
--    restores it, whatever path tries to put it back: the landlord's dashboard,
--    an accepted website-sync event, the daily sync's auto-apply, or any route
--    added later. The rule used to live in one API route only. The trigger
--    refuses an update that takes such a lease from withdrawn to live. Restoring
--    marks the withdrawal restored first, so it passes.
--
-- Idempotent. Apply to BOTH dev and prod (prod together with 202610310001 and
-- 202611010001, which this depends on).

ALTER TABLE public.billing_invoices ALTER COLUMN invoice_date DROP NOT NULL;
ALTER TABLE public.billing_invoices ALTER COLUMN invoice_date DROP DEFAULT;

-- Rows a run left behind before Stripe finalized them: no Stripe invoice yet, so
-- no real invoice date either.
UPDATE public.billing_invoices
   SET invoice_date = NULL
 WHERE status = 'open' AND stripe_invoice_id IS NULL;

CREATE OR REPLACE FUNCTION public.fn_block_relisting_billing_hold()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.is_active AND NOT NEW.unavailable
     AND NOT (OLD.is_active AND NOT OLD.unavailable)
     AND EXISTS (
       SELECT 1 FROM public.billing_lease_withdrawals w
        WHERE w.lease_id = NEW.id AND w.restored_at IS NULL
     )
  THEN
    RAISE EXCEPTION 'lease_held_for_billing: this lease was withdrawn for an overdue invoice and only an admin can restore it'
      USING ERRCODE = 'P0001', HINT = 'lease_held_for_billing';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_block_relisting_billing_hold() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_block_relisting_billing_hold() TO service_role;

DROP TRIGGER IF EXISTS trg_block_relisting_billing_hold ON public.unit_leases;
CREATE TRIGGER trg_block_relisting_billing_hold
  BEFORE UPDATE OF is_active, unavailable ON public.unit_leases
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_block_relisting_billing_hold();

NOTIFY pgrst, 'reload schema';
