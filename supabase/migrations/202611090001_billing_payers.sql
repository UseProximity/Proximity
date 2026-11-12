-- A billing account that signs and pays for another landlord account (Project B,
-- Wyatt 2026-11-09).
--
-- A landlord account (often a property manager) names a payer: the owner, who
-- signs the marketing agreement and pays the invoices. The payer holds ONE master
-- agreement (landlord_agreements.user_id = payer); each landlord account that
-- names them adds its properties by an Addendum to Exhibit A signed by the payer
-- (agreement_amendments.user_id = the landlord account, signer_id = the payer).
-- Coverage rows stay on the landlord account whose properties they are
-- (agreement_coverage.user_id), pointing at the payer's master.
--
-- ── billing_payers ──────────────────────────────────────────────────────────
-- Who pays for a landlord account. One active row per account. listing_id is
-- for a payer per building later (Project C); Project B only writes NULL.
--   signer_name / signer_email  as the landlord typed them
--   invited_at                  when the payer was last emailed
--   status                      active | ended (the payer voided, or an admin ended it)
--   declined_at                 the payer declined the last document for this account;
--                               cleared when the landlord asks again
--
-- ── payer_publish_requests ──────────────────────────────────────────────────
-- Properties a landlord with a payer asked to publish: drafts until the payer
-- signs the document covering them, then published and the landlord emailed.
--   status  waiting | published | cancelled (a listing the signer leaves off just stays waiting)
--
-- ── users.billing_only ──────────────────────────────────────────────────────
-- A landlord account made for a payer: no listings, analytics or listing tools.
--
-- ── charges.payer_id ────────────────────────────────────────────────────────
-- Who is invoiced for a charge when it is not the landlord: the holder of the
-- agreement covering it. The billing run invoices coalesce(payer_id, landlord_id).
--
-- Server-side only (service role). Idempotent. Apply to BOTH dev and prod.

CREATE TABLE IF NOT EXISTS public.billing_payers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  landlord_id   uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  payer_id      uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  listing_id    uuid REFERENCES public.listings(id) ON DELETE CASCADE,
  signer_name   text NOT NULL CHECK (length(btrim(signer_name)) BETWEEN 1 AND 100),
  signer_email  text NOT NULL CHECK (signer_email = lower(btrim(signer_email)) AND position('@' IN signer_email) > 1),
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended')),
  ended_reason  text,
  ended_at      timestamptz,
  created_by    uuid REFERENCES public.users(id) ON DELETE SET NULL,
  invited_at    timestamptz NOT NULL DEFAULT now(),
  declined_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (landlord_id <> payer_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_billing_payers_active
  ON public.billing_payers (landlord_id, COALESCE(listing_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_billing_payers_payer ON public.billing_payers (payer_id) WHERE status = 'active';

DROP TRIGGER IF EXISTS trg_set_updated_at_billing_payers ON public.billing_payers;
CREATE TRIGGER trg_set_updated_at_billing_payers
  BEFORE UPDATE ON public.billing_payers
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE TABLE IF NOT EXISTS public.payer_publish_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  landlord_id   uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  listing_id    uuid NOT NULL REFERENCES public.listings(id) ON DELETE CASCADE,
  payer_link_id uuid NOT NULL REFERENCES public.billing_payers(id) ON DELETE CASCADE,
  status        text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'published', 'cancelled')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  resolved_at   timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_payer_publish_requests_waiting
  ON public.payer_publish_requests (landlord_id, listing_id) WHERE status = 'waiting';

ALTER TABLE public.billing_payers ADD COLUMN IF NOT EXISTS declined_at timestamptz;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS billing_only boolean NOT NULL DEFAULT false;
ALTER TABLE public.agreement_amendments ADD COLUMN IF NOT EXISTS signer_id uuid REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE public.charges ADD COLUMN IF NOT EXISTS payer_id uuid REFERENCES public.users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_charges_payer ON public.charges (payer_id) WHERE payer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_agreement_amendments_signer ON public.agreement_amendments (signer_id) WHERE signer_id IS NOT NULL;

ALTER TABLE public.billing_payers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payer_publish_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_payers FROM anon, authenticated;
REVOKE ALL ON public.payer_publish_requests FROM anon, authenticated;
