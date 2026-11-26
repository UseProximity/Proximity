-- Invoices the landlord pays (Stripe send_invoice), optional autopay, and the
-- signed-rent basis on charges (In-App Payments, decisions of 2026-11-04).
--
-- ── billing_invoices ────────────────────────────────────────────────────────
--   collection_method        send_invoice from now on: Stripe never debits on its
--                            own. Invoices made before this keep charge_automatically.
--   due_date                 30 days after the invoice is sent. The overdue job
--                            counts its 30 days from here.
--   autopay_*                set when the landlord has autopay on: the method and
--                            the date it will be charged (5 business days after the
--                            invoice is sent), when it was tried, or why it was skipped
--
-- ── autopay_authorizations ──────────────────────────────────────────────────
-- A landlord's consent to autopay: which saved method, the exact wording they
-- agreed to, and when. At most one active (revoked_at null) per landlord. Turning
-- autopay off, or the method going away, revokes it with a reason; a new consent
-- is a new row, so the history is kept.
--
-- ── charges ─────────────────────────────────────────────────────────────────
--   signed_rent_cents        the commission basis: the rent signed for, not the
--                            advertised price. Set by whatever creates the charge
--                            (the Triggering project), never guessed here.
--   commission_rate_percent  the rate from the agreement that covers the charge
--   covered_by_*             the master agreement and, if the property was added
--                            later, the amendment that covers it
--
-- Idempotent. Apply to BOTH dev and prod.

ALTER TABLE public.billing_invoices
  ADD COLUMN IF NOT EXISTS collection_method          text NOT NULL DEFAULT 'charge_automatically',
  ADD COLUMN IF NOT EXISTS due_date                   timestamptz,
  ADD COLUMN IF NOT EXISTS sent_at                    timestamptz,
  ADD COLUMN IF NOT EXISTS autopay_payment_method_id  uuid REFERENCES public.payment_methods(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS autopay_scheduled_for      timestamptz,
  ADD COLUMN IF NOT EXISTS autopay_attempted_at       timestamptz,
  ADD COLUMN IF NOT EXISTS autopay_skipped_reason     text;

-- New invoices are send_invoice.
ALTER TABLE public.billing_invoices ALTER COLUMN collection_method SET DEFAULT 'send_invoice';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'billing_invoices_collection_method_check') THEN
    ALTER TABLE public.billing_invoices
      ADD CONSTRAINT billing_invoices_collection_method_check
      CHECK (collection_method IN ('send_invoice', 'charge_automatically'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_billing_invoices_due
  ON public.billing_invoices (due_date) WHERE status IN ('open', 'processing', 'failed');
CREATE INDEX IF NOT EXISTS idx_billing_invoices_autopay
  ON public.billing_invoices (autopay_scheduled_for)
  WHERE autopay_scheduled_for IS NOT NULL AND autopay_attempted_at IS NULL AND status = 'open';

CREATE TABLE IF NOT EXISTS public.autopay_authorizations (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  payment_method_id     uuid NOT NULL REFERENCES public.payment_methods(id) ON DELETE RESTRICT,
  consent_text          text NOT NULL,
  authorized_at         timestamptz NOT NULL DEFAULT now(),
  user_agent            text,
  consecutive_failures  integer NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  revoked_at            timestamptz,
  revoked_reason        text,
  revoked_by_id         uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_autopay_authorizations_active
  ON public.autopay_authorizations (user_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_autopay_authorizations_method
  ON public.autopay_authorizations (payment_method_id) WHERE revoked_at IS NULL;

ALTER TABLE public.charges
  ADD COLUMN IF NOT EXISTS signed_rent_cents        integer CHECK (signed_rent_cents IS NULL OR signed_rent_cents >= 0),
  ADD COLUMN IF NOT EXISTS commission_rate_percent  numeric(6,3),
  ADD COLUMN IF NOT EXISTS covered_by_agreement_id  uuid REFERENCES public.landlord_agreements(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS covered_by_amendment_id  uuid REFERENCES public.agreement_amendments(id) ON DELETE RESTRICT;

ALTER TABLE public.autopay_authorizations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.autopay_authorizations FROM anon, authenticated;

DROP TRIGGER IF EXISTS trg_set_updated_at_autopay_authorizations ON public.autopay_authorizations;
CREATE TRIGGER trg_set_updated_at_autopay_authorizations
  BEFORE UPDATE ON public.autopay_authorizations
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

DROP TRIGGER IF EXISTS trg_action_log_autopay_authorizations ON public.autopay_authorizations;
CREATE TRIGGER trg_action_log_autopay_authorizations
  AFTER INSERT OR UPDATE OR DELETE ON public.autopay_authorizations
  FOR EACH ROW EXECUTE FUNCTION fn_action_log();

NOTIFY pgrst, 'reload schema';
