-- Bedroom, bathroom, and area counts can never be negative.
--
-- Four listings went live on 2026-08-31 with -2 bed / -1 bath: the add-listing
-- unit inputs carried no min, so a spinner arrow on an empty field walked past
-- zero, and nothing downstream re-checked. The inputs clamp and the API routes
-- reject now; this is the layer that holds regardless of how a row arrives
-- (importer, admin panel, a form written next year).
--
-- NOT VALID: the six already-live rows are left exactly as they are, to be
-- corrected with the landlord rather than guessed at here. The constraint still
-- applies in full to every INSERT and UPDATE from this point on. Run
-- `VALIDATE CONSTRAINT` once those rows have real numbers.

ALTER TABLE listing_units
  ADD CONSTRAINT listing_units_counts_nonneg
  CHECK (
    bedrooms >= 0
    AND bathrooms >= 0
    AND (area IS NULL OR area >= 0)
  )
  NOT VALID;
