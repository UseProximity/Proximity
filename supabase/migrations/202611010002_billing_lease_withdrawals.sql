-- Remember which leases the overdue-invoice job withdrew, so an admin can put back
-- exactly those and nothing else (In-App Payments, phase 7).
--
-- An invoice unpaid more than 30 days after its invoice date withdraws the
-- landlord's leases (hides them from students). That is the same withdrawal a
-- landlord does by hand: unit_leases.is_active = false and unavailable = true.
-- Restoring after the invoice is paid has to undo only what billing did. A lease
-- the landlord had already withdrawn, or one that was a draft, must stay as it
-- was, so billing keeps its own list instead of guessing from the lease row.
--
--   invoice_id   the overdue invoice that caused the withdrawal
--   lease_id     the lease that was live and was withdrawn (cascades away with the lease)
--   restored_at  set when an admin restores it; NULL while it is still withdrawn
--   restored_by  the admin who restored it
--
-- One row per (invoice, lease), so running the job twice cannot list a lease twice.
-- Service role only: RLS on, no policies.
--
-- Idempotent. Apply to BOTH dev and prod.

CREATE TABLE IF NOT EXISTS public.billing_lease_withdrawals (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id     uuid NOT NULL REFERENCES public.billing_invoices(id) ON DELETE RESTRICT,
  lease_id       uuid NOT NULL REFERENCES public.unit_leases(id) ON DELETE CASCADE,
  withdrawn_at   timestamptz NOT NULL DEFAULT now(),
  restored_at    timestamptz,
  restored_by_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  UNIQUE (invoice_id, lease_id)
);

-- The admin view and the restore action look for what is still withdrawn.
CREATE INDEX IF NOT EXISTS idx_billing_lease_withdrawals_open
  ON public.billing_lease_withdrawals (invoice_id) WHERE restored_at IS NULL;

ALTER TABLE public.billing_lease_withdrawals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_lease_withdrawals FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';
