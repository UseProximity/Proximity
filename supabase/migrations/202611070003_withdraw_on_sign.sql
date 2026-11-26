-- Live properties a landlord left off Exhibit A on the signing popup. They come
-- off the site only once this document is signed, never on an abandoned popup
-- (release #395 review). Empty for everything signed before.
ALTER TABLE public.landlord_agreements ADD COLUMN IF NOT EXISTS withdraw_on_sign uuid[] NOT NULL DEFAULT '{}';
ALTER TABLE public.agreement_amendments ADD COLUMN IF NOT EXISTS withdraw_on_sign uuid[] NOT NULL DEFAULT '{}';
