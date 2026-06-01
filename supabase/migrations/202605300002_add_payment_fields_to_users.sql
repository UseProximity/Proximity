-- Ambassador payout details: how they want to be paid (zelle/venmo) and their handle.
-- Set on the /refer dashboard, read by /api/admin/referrals so admins know where to send prizes.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS payment_method text
    CHECK (payment_method IS NULL OR payment_method IN ('zelle', 'venmo')),
  ADD COLUMN IF NOT EXISTS payment_handle text;
