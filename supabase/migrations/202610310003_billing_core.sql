-- In-app payments and landlord billing: core schema (Stripe integration, phase 1).
--
-- Nothing in the database held payments before this. Landlords are users rows
-- with the landlord role (there is no landlord or company table), so every
-- billing table points at public.users(id). Charges belong to a landlord user,
-- never to a listing: one listing can produce charges for several landlords.
--
-- Money is integer cents (Stripe's unit). Every status is text with a CHECK,
-- like the rest of the schema (no enums). Foreign keys to users are RESTRICT
-- because financial records must not vanish; users are tombstoned, not deleted,
-- so this never fires in practice. Links to listings, leases and the student are
-- SET NULL so a charge survives them (the row keeps its amount and trigger).
--
--   billing_settings        key/value switches (agreement_required, ...)
--   billing_accounts        one per landlord: their Stripe Customer id
--   payment_methods         Stripe payment method ids plus display fields only
--                           (brand, last4, expiry, bank name). Never raw card
--                           or bank details.
--   charges                 one chargeable event, with its lifecycle status
--   charge_status_history   every status change with who made it
--   billing_invoices        one Stripe invoice per landlord per billing month
--   charge_adjustments      refund or credit correcting a Paid charge (the
--                           charge itself is never edited)
--   billing_disputes        Stripe chargebacks
--   landlord_agreements     commission agreement scaffolding, no e-sign provider
--   stripe_webhook_events   event ids already handled, for idempotency
--
-- Charge lifecycle (enforced by trg_charges_enforce_transition, and written
-- through rpc_transition_charge so the update and its history row are one
-- transaction):
--
--   unconfirmed -> pending    admin confirms; starts the 7 day review clock
--   unconfirmed -> approved   landlord approves early
--   unconfirmed -> contested  landlord contests
--   unconfirmed -> voided     admin voids
--   pending     -> approved   landlord approves, or the 7 days pass
--   pending     -> contested  landlord contests
--   pending     -> voided     admin voids
--   contested   -> approved   admin resolves in Proximity's favour
--   contested   -> voided     admin resolves against the charge
--   approved    -> invoiced   billing run adds it to a monthly invoice
--   approved    -> voided     admin voids
--   invoiced    -> paid       Stripe reports the invoice paid
--   invoiced    -> approved   the invoice was voided, so it rolls to the next run
--   invoiced    -> voided     admin voids a charge on an open invoice
--   paid, voided              terminal
--
-- All tables are service role only: RLS on, no policies (like waitlist_clicks).
-- Idempotent. Apply to BOTH dev and prod.

-- ── billing_settings ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.billing_settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL
);

-- Off until the agreement is ready, so it cannot block listing creation at launch.
INSERT INTO public.billing_settings (key, value)
VALUES ('agreement_required', 'false'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- ── billing_accounts ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.billing_accounts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE RESTRICT,
  stripe_customer_id text UNIQUE,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- ── payment_methods ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.payment_methods (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  stripe_payment_method_id text NOT NULL UNIQUE,
  type                     text NOT NULL CHECK (type IN ('us_bank_account', 'card')),
  status                   text NOT NULL DEFAULT 'active'
                           CHECK (status IN ('verifying', 'active', 'expired', 'failed')),
  is_default               boolean NOT NULL DEFAULT false,
  brand                    text,
  last4                    text,
  exp_month                integer CHECK (exp_month IS NULL OR exp_month BETWEEN 1 AND 12),
  exp_year                 integer,
  bank_name                text,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  deleted_at               timestamptz
);

CREATE INDEX IF NOT EXISTS idx_payment_methods_user
  ON public.payment_methods (user_id) WHERE deleted_at IS NULL;
-- One default method per landlord.
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_methods_default
  ON public.payment_methods (user_id) WHERE is_default AND deleted_at IS NULL;

-- ── billing_invoices ────────────────────────────────────────────────────────
-- billing_period is the first day of the billing month (America/Chicago), and
-- with landlord_id it is the idempotency key for the monthly run.
CREATE TABLE IF NOT EXISTS public.billing_invoices (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  landlord_id           uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  billing_period        date NOT NULL,
  stripe_invoice_id     text UNIQUE,
  status                text NOT NULL DEFAULT 'open'
                        CHECK (status IN ('open', 'processing', 'paid', 'failed', 'void', 'uncollectible')),
  total_cents           integer NOT NULL CHECK (total_cents >= 0),
  invoice_date          timestamptz NOT NULL DEFAULT now(),
  hosted_invoice_url    text,
  invoice_pdf_url       text,
  processing_started_at timestamptz,
  paid_at               timestamptz,
  failed_at             timestamptz,
  last_failure_message  text,
  disputed              boolean NOT NULL DEFAULT false,
  overdue_actioned_at   timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (landlord_id, billing_period)
);

CREATE INDEX IF NOT EXISTS idx_billing_invoices_landlord
  ON public.billing_invoices (landlord_id, invoice_date DESC);
-- The overdue cron scans unpaid invoices only.
CREATE INDEX IF NOT EXISTS idx_billing_invoices_unpaid
  ON public.billing_invoices (invoice_date) WHERE status IN ('open', 'processing', 'failed');

-- ── charges ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.charges (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  landlord_id            uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  amount_cents           integer NOT NULL CHECK (amount_cents > 0),
  description            text,
  -- Defined by the separate Triggering project; free text here on purpose.
  trigger_type           text NOT NULL CHECK (length(btrim(trigger_type)) > 0),
  trigger_ref            text,
  listing_id             uuid REFERENCES public.listings(id) ON DELETE SET NULL,
  lease_id               uuid REFERENCES public.unit_leases(id) ON DELETE SET NULL,
  student_id             uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_by_type        text NOT NULL DEFAULT 'system' CHECK (created_by_type IN ('system', 'admin')),
  created_by_id          uuid REFERENCES public.users(id) ON DELETE SET NULL,
  is_test                boolean NOT NULL DEFAULT false,
  status                 text NOT NULL DEFAULT 'unconfirmed'
                         CHECK (status IN ('unconfirmed', 'pending', 'approved', 'invoiced', 'paid', 'contested', 'voided')),
  -- The 7 day review clock starts here, not at created_at.
  pending_at             timestamptz,
  approved_at            timestamptz,
  contested_at           timestamptz,
  contest_reason         text,
  resolved_at            timestamptz,
  resolved_by_id         uuid REFERENCES public.users(id) ON DELETE SET NULL,
  resolution_note        text,
  voided_at              timestamptz,
  invoiced_at            timestamptz,
  paid_at                timestamptz,
  invoice_id             uuid REFERENCES public.billing_invoices(id) ON DELETE SET NULL,
  stripe_invoice_item_id text UNIQUE,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  -- A charge is on an invoice exactly while invoiced or paid.
  CHECK (status NOT IN ('invoiced', 'paid') OR invoice_id IS NOT NULL OR stripe_invoice_item_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_charges_landlord_status ON public.charges (landlord_id, status);
-- Review clock cron: pending charges whose 7 days are up.
CREATE INDEX IF NOT EXISTS idx_charges_pending_clock ON public.charges (pending_at) WHERE status = 'pending';
-- Billing run: approved charges not yet on an invoice.
CREATE INDEX IF NOT EXISTS idx_charges_billable
  ON public.charges (landlord_id) WHERE status = 'approved' AND invoice_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_charges_invoice ON public.charges (invoice_id) WHERE invoice_id IS NOT NULL;
-- Admin review view.
CREATE INDEX IF NOT EXISTS idx_charges_admin_queue
  ON public.charges (created_at) WHERE status IN ('unconfirmed', 'contested');

-- ── charge_status_history ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.charge_status_history (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  charge_id     uuid NOT NULL REFERENCES public.charges(id) ON DELETE RESTRICT,
  from_status   text,
  to_status     text NOT NULL,
  actor_type    text NOT NULL CHECK (actor_type IN ('landlord', 'admin', 'system')),
  actor_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (actor_type = 'system' OR actor_user_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_charge_status_history_charge
  ON public.charge_status_history (charge_id, created_at);

-- ── charge_adjustments ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.charge_adjustments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  charge_id        uuid NOT NULL REFERENCES public.charges(id) ON DELETE RESTRICT,
  kind             text NOT NULL CHECK (kind IN ('refund', 'credit')),
  amount_cents     integer NOT NULL CHECK (amount_cents > 0),
  reason           text NOT NULL CHECK (length(btrim(reason)) > 0),
  stripe_refund_id text UNIQUE,
  created_by_id    uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_charge_adjustments_charge ON public.charge_adjustments (charge_id);

-- ── billing_disputes ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.billing_disputes (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id        uuid REFERENCES public.billing_invoices(id) ON DELETE SET NULL,
  stripe_dispute_id text NOT NULL UNIQUE,
  amount_cents      integer NOT NULL CHECK (amount_cents >= 0),
  reason            text,
  status            text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_billing_disputes_invoice
  ON public.billing_disputes (invoice_id) WHERE invoice_id IS NOT NULL;

-- ── landlord_agreements ─────────────────────────────────────────────────────
-- provider and provider_envelope_id stay empty until an e-signature provider is
-- chosen; the listing gate reads status only, so adding one changes no gate code.
CREATE TABLE IF NOT EXISTS public.landlord_agreements (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  version              text NOT NULL,
  status               text NOT NULL DEFAULT 'not_sent'
                       CHECK (status IN ('not_sent', 'sent', 'signed', 'voided')),
  signed_at            timestamptz,
  signer_name          text,
  signed_file_key      text,
  provider             text,
  provider_envelope_id text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'signed' OR signed_at IS NOT NULL)
);

-- One live agreement per landlord; a new version replaces a voided one.
CREATE UNIQUE INDEX IF NOT EXISTS uq_landlord_agreements_live
  ON public.landlord_agreements (user_id) WHERE status <> 'voided';

-- ── stripe_webhook_events ───────────────────────────────────────────────────
-- A row is claimed on first sight and stamped processed_at when handled. Stripe
-- redelivers until it gets a 2xx, so a row with processed_at NULL is retried.
CREATE TABLE IF NOT EXISTS public.stripe_webhook_events (
  stripe_event_id text PRIMARY KEY,
  type            text NOT NULL,
  livemode        boolean NOT NULL DEFAULT false,
  received_at     timestamptz NOT NULL DEFAULT now(),
  processed_at    timestamptz,
  error           text
);

CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_unprocessed
  ON public.stripe_webhook_events (received_at) WHERE processed_at IS NULL;

-- ── RLS: service role only ──────────────────────────────────────────────────
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'billing_settings', 'billing_accounts', 'payment_methods', 'billing_invoices', 'charges',
    'charge_status_history', 'charge_adjustments', 'billing_disputes', 'landlord_agreements',
    'stripe_webhook_events'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', tbl);
  END LOOP;
END $$;

-- ── updated_at and audit triggers ───────────────────────────────────────────
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'billing_accounts', 'payment_methods', 'billing_invoices', 'charges',
    'billing_disputes', 'landlord_agreements'
  ] LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_set_updated_at_%1$s ON public.%1$I;
       CREATE TRIGGER trg_set_updated_at_%1$s
         BEFORE UPDATE ON public.%1$I
         FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();',
      tbl
    );
  END LOOP;

  -- action_log is the generic audit trail; charges also have their own history
  -- table (with the landlord/admin actor), this one catches every other field.
  FOREACH tbl IN ARRAY ARRAY['charges', 'billing_invoices', 'landlord_agreements'] LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_action_log_%1$s ON public.%1$I;
       CREATE TRIGGER trg_action_log_%1$s
         AFTER INSERT OR UPDATE OR DELETE ON public.%1$I
         FOR EACH ROW EXECUTE FUNCTION fn_action_log();',
      tbl
    );
  END LOOP;
END $$;

-- ── lifecycle enforcement ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_charge_transition_allowed(p_from text, p_to text)
RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE p_from
    WHEN 'unconfirmed' THEN p_to IN ('pending', 'approved', 'contested', 'voided')
    WHEN 'pending'     THEN p_to IN ('approved', 'contested', 'voided')
    WHEN 'contested'   THEN p_to IN ('approved', 'voided')
    WHEN 'approved'    THEN p_to IN ('invoiced', 'voided')
    WHEN 'invoiced'    THEN p_to IN ('paid', 'approved', 'voided')
    ELSE false
  END
$$;

CREATE OR REPLACE FUNCTION public.fn_charges_enforce_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NOT public.fn_charge_transition_allowed(OLD.status, NEW.status) THEN
    RAISE EXCEPTION 'invalid charge transition % -> %', OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_charges_enforce_transition ON public.charges;
CREATE TRIGGER trg_charges_enforce_transition
  BEFORE UPDATE OF status ON public.charges
  FOR EACH ROW EXECUTE FUNCTION public.fn_charges_enforce_transition();

-- Move a charge to a new status and record who did it, atomically. The row is
-- locked, and p_expected_from makes it a compare-and-swap: if the landlord
-- approves while the review cron runs, one of them gets 'charge_status_changed'
-- instead of both writing. Errors carry a stable message the API maps to a status:
--   charge_not_found, charge_status_changed, charge_note_required, charge_actor_required
--
-- SECURITY INVOKER on purpose: it adds no privilege, and every table above is
-- already closed to anon and authenticated. The grants below keep it
-- service role only anyway. search_path is repeated if this is ever replaced.
CREATE OR REPLACE FUNCTION public.rpc_transition_charge(
  p_charge_id             uuid,
  p_expected_from         text,
  p_to                    text,
  p_actor_type            text,
  p_actor_user_id         uuid DEFAULT NULL,
  p_note                  text DEFAULT NULL,
  p_invoice_id            uuid DEFAULT NULL,
  p_stripe_invoice_item_id text DEFAULT NULL
)
RETURNS public.charges
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_charge public.charges;
  v_note   text := NULLIF(btrim(p_note), '');
  v_now    timestamptz := now();
BEGIN
  IF p_actor_type NOT IN ('landlord', 'admin', 'system') THEN
    RAISE EXCEPTION 'charge_actor_required';
  END IF;
  IF p_actor_type <> 'system' AND p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'charge_actor_required';
  END IF;

  SELECT * INTO v_charge FROM public.charges WHERE id = p_charge_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'charge_not_found';
  END IF;
  IF v_charge.status <> p_expected_from THEN
    RAISE EXCEPTION 'charge_status_changed';
  END IF;

  -- A contest needs the landlord's reason; voiding and resolving a contest need
  -- the admin's internal note.
  IF (p_to = 'contested' OR p_to = 'voided' OR (p_expected_from = 'contested' AND p_to = 'approved'))
     AND v_note IS NULL THEN
    RAISE EXCEPTION 'charge_note_required';
  END IF;

  UPDATE public.charges SET
    status                 = p_to,
    pending_at             = CASE WHEN p_to = 'pending' THEN v_now ELSE pending_at END,
    approved_at            = CASE WHEN p_to = 'approved' THEN v_now ELSE approved_at END,
    contested_at           = CASE WHEN p_to = 'contested' THEN v_now ELSE contested_at END,
    contest_reason         = CASE WHEN p_to = 'contested' THEN v_note ELSE contest_reason END,
    resolved_at            = CASE WHEN p_expected_from = 'contested' THEN v_now ELSE resolved_at END,
    resolved_by_id         = CASE WHEN p_expected_from = 'contested' THEN p_actor_user_id ELSE resolved_by_id END,
    resolution_note        = CASE WHEN p_expected_from = 'contested' THEN v_note ELSE resolution_note END,
    voided_at              = CASE WHEN p_to = 'voided' THEN v_now ELSE voided_at END,
    invoiced_at            = CASE WHEN p_to = 'invoiced' THEN v_now ELSE invoiced_at END,
    paid_at                = CASE WHEN p_to = 'paid' THEN v_now ELSE paid_at END,
    -- Rolling an invoiced charge back to approved puts it back in the next run.
    invoice_id             = CASE WHEN p_to = 'invoiced' THEN p_invoice_id
                                  WHEN p_to IN ('approved', 'voided') THEN NULL
                                  ELSE invoice_id END,
    stripe_invoice_item_id = CASE WHEN p_to = 'invoiced' THEN p_stripe_invoice_item_id
                                  WHEN p_to IN ('approved', 'voided') THEN NULL
                                  ELSE stripe_invoice_item_id END
  WHERE id = p_charge_id
  RETURNING * INTO v_charge;

  INSERT INTO public.charge_status_history (charge_id, from_status, to_status, actor_type, actor_user_id, note)
  VALUES (p_charge_id, p_expected_from, p_to, p_actor_type, p_actor_user_id, v_note);

  RETURN v_charge;
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_transition_charge(uuid, text, text, text, uuid, text, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_transition_charge(uuid, text, text, text, uuid, text, uuid, text)
  TO service_role;
ALTER FUNCTION public.rpc_transition_charge(uuid, text, text, text, uuid, text, uuid, text)
  SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION public.fn_charge_transition_allowed(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_charge_transition_allowed(text, text) TO service_role;
REVOKE ALL ON FUNCTION public.fn_charges_enforce_transition() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_charges_enforce_transition() TO service_role;

NOTIFY pgrst, 'reload schema';
