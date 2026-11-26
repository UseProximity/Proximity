-- An authorized payer, and signers and payers per listing (Wyatt, 2026-11-25).
--
-- Until now the authorized signer of a landlord account was always the one
-- invoiced too. Now the two are separate roles on billing_payers, and each can
-- be set for the whole account (listing_id NULL) or for one of its listings:
--
--   role = 'signer'  signs the marketing agreement. Who signs for a listing: its
--                    own signer, else the account's signer, else the landlord.
--   role = 'payer'   is invoiced and holds the payment method, once they accept
--                    (accepted_at). Who is invoiced for a listing: its own payer,
--                    else the account's payer, else whoever signs for it, else
--                    the landlord. A payer who has not accepted yet changes
--                    nothing: the one before them stays billed.
--
-- billing_payers.payer_id stays the person named, whatever their role. Rows
-- written before this are signers (the default), so nothing changes for them.
-- The same person can be named by any number of landlord accounts.
--
-- One active link per account per listing PER ROLE, so a listing (or the account)
-- can have both a signer and a payer.
--
-- An account can then have an Addendum to Exhibit A in progress with each of its
-- signers (and one of its own) at the same time: one pending addendum per account
-- per signer, instead of one per account.
--
-- Server-side only (service role). Idempotent. Apply to BOTH dev and prod, and
-- BEFORE the code that reads billing_payers.role is deployed.

ALTER TABLE public.billing_payers ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'signer';
ALTER TABLE public.billing_payers DROP CONSTRAINT IF EXISTS billing_payers_role_check;
ALTER TABLE public.billing_payers ADD CONSTRAINT billing_payers_role_check CHECK (role IN ('signer', 'payer'));
ALTER TABLE public.billing_payers ADD COLUMN IF NOT EXISTS accepted_at timestamptz;

DROP INDEX IF EXISTS public.uq_billing_payers_active;
CREATE UNIQUE INDEX IF NOT EXISTS uq_billing_payers_active
  ON public.billing_payers (landlord_id, COALESCE(listing_id, '00000000-0000-0000-0000-000000000000'::uuid), role)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_billing_payers_listing
  ON public.billing_payers (listing_id) WHERE listing_id IS NOT NULL AND status = 'active';

DROP INDEX IF EXISTS public.uq_agreement_amendments_pending;
CREATE UNIQUE INDEX IF NOT EXISTS uq_agreement_amendments_pending
  ON public.agreement_amendments (user_id, COALESCE(signer_id, user_id))
  WHERE status = 'sent';
