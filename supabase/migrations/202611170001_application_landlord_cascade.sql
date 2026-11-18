-- Apply tracking: a deleted landlord takes their Apply rows with them
-- (Wyatt, 2026-11-17, PR 447 review).
--
-- landlord_id was ON DELETE SET NULL, but the unique index from
-- 202611160001 keys a row on COALESCE(landlord_id::text, application_url).
-- Blanking the landlord turned the key into the link, which another row
-- (a co-landlord who shared the same portal link) could already hold, so
-- deleting the landlord failed with a unique violation. Their clicks are of
-- no use once the landlord is gone, so the rows are deleted instead.
--
-- NOT VALID like the constraint it replaces: no existing row is rechecked.
-- Idempotent. Apply to BOTH dev and prod.

ALTER TABLE public.listing_applications
  DROP CONSTRAINT IF EXISTS listing_applications_landlord_id_fkey;

ALTER TABLE public.listing_applications
  ADD CONSTRAINT listing_applications_landlord_id_fkey
  FOREIGN KEY (landlord_id) REFERENCES public.users(id) ON DELETE CASCADE NOT VALID;
