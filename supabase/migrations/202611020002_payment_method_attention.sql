-- Remember which "update your payment method" email a payment method has already
-- triggered (In-App Payments, PR #370 review), so the daily check emails a
-- landlord once per problem instead of every day.
--
--   attention_emailed_key  what was emailed about, as "<state>:<month>/<year>",
--                          state being expiring, expired or failed. A card the
--                          card updater renews gets a new expiry, so a new key,
--                          and can be warned about again when that one runs out.
--                          Cleared by the check once the method is fine again.
--   attention_emailed_at   when
--
-- Idempotent. Apply to BOTH dev and prod (prod together with 202610310001).

ALTER TABLE public.payment_methods ADD COLUMN IF NOT EXISTS attention_emailed_key text;
ALTER TABLE public.payment_methods ADD COLUMN IF NOT EXISTS attention_emailed_at timestamptz;

NOTIFY pgrst, 'reload schema';
