-- Several sizes and lease lengths at once (Wyatt, 2026-11-01). A listing's
-- lease options are narrowed by toggle pills: "Studio or 1 bed, for 9 or 12
-- months". The picks are saved on the account as lists.
--
--   preferred_beds_list          bed counts, 0 for a studio. Empty or NULL
--                                means any size.
--   preferred_lease_months_list  lease lengths in months. Empty or NULL means
--                                any length.
--
-- The single columns from 202610270001 and 202610300001 stay and keep the
-- first pick, so nothing that reads them breaks. Backfilled from them here.
-- Additive and idempotent: safe to run before or after the code that uses it.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS preferred_beds_list integer[],
  ADD COLUMN IF NOT EXISTS preferred_lease_months_list integer[];

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_preferred_beds_list_range'
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_preferred_beds_list_range
      CHECK (preferred_beds_list IS NULL OR preferred_beds_list <@ ARRAY[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20]);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_preferred_lease_months_list_range'
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_preferred_lease_months_list_range
      CHECK (
        preferred_lease_months_list IS NULL
        OR (cardinality(preferred_lease_months_list) <= 60
            AND 1 <= ALL (preferred_lease_months_list)
            AND 60 >= ALL (preferred_lease_months_list))
      );
  END IF;
END $$;

UPDATE public.users
SET preferred_beds_list = ARRAY[preferred_beds]
WHERE preferred_beds IS NOT NULL AND preferred_beds_list IS NULL;

UPDATE public.users
SET preferred_lease_months_list = ARRAY[preferred_lease_months]
WHERE preferred_lease_months IS NOT NULL AND preferred_lease_months_list IS NULL;
