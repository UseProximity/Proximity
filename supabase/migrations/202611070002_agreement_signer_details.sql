-- The details a landlord confirmed on the signing popup (Wyatt, 2026-11-07):
-- { company, email, street, suite, city }. Saved with the agreement so an
-- Addendum to Exhibit A fills the same signature block without asking again;
-- signer_name and signer_title already hold the name and title. Saved on an
-- addendum too, as the record of what it was signed with.
ALTER TABLE public.landlord_agreements ADD COLUMN IF NOT EXISTS signer_details jsonb;
ALTER TABLE public.agreement_amendments ADD COLUMN IF NOT EXISTS signer_details jsonb;
