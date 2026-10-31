-- A student's move-in month and lease length, saved on their account so the
-- lease options on every unit open already narrowed to what they want
-- (Wyatt, 2026-10-27).
--
--   preferred_move_in_date  the first day of the month they want to move in.
--                           Only the month is meaningful: a lease fits when it
--                           starts on or before the end of that month.
--   preferred_lease_months  the exact lease length they want, in months. A
--                           lease fits when its lease_term_months contains it.
--
-- Both are nullable: NULL means the student has not said. Written by
-- PATCH /api/editProfile and read by GET /api/account/lease-preferences.
-- Nothing else reads them yet.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS preferred_move_in_date date,
  ADD COLUMN IF NOT EXISTS preferred_lease_months integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_preferred_lease_months_range'
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_preferred_lease_months_range
      CHECK (preferred_lease_months IS NULL OR preferred_lease_months BETWEEN 1 AND 60);
  END IF;
END $$;
