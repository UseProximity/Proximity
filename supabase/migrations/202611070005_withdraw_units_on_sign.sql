-- Units a landlord deselected on the signing popup that hold their leases. Those
-- leases come off the site once this document is signed, like the properties in
-- withdraw_on_sign (Wyatt, 2026-11-07). Empty for everything signed before.
ALTER TABLE public.landlord_agreements ADD COLUMN IF NOT EXISTS withdraw_unit_ids_on_sign uuid[] NOT NULL DEFAULT '{}';
ALTER TABLE public.agreement_amendments ADD COLUMN IF NOT EXISTS withdraw_unit_ids_on_sign uuid[] NOT NULL DEFAULT '{}';
