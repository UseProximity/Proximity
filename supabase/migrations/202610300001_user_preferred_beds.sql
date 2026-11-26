-- The bed count a student wants, saved with their move-in month and lease
-- length (Wyatt, 2026-10-30). A listing's leases open on "I want a [beds] for
-- [length] starting [month]", and all three start on what the student saved.
--
--   preferred_beds  0 for a studio, otherwise the number of bedrooms. NULL
--                   means the student has not said.
--
-- Written by PATCH /api/editProfile and read by GET
-- /api/account/lease-preferences, like the other two.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS preferred_beds integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_preferred_beds_range'
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_preferred_beds_range
      CHECK (preferred_beds IS NULL OR preferred_beds BETWEEN 0 AND 20);
  END IF;
END $$;
