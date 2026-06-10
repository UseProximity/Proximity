-- Lease terms become multi-valued per unit: unit_leases.lease_term_months -> integer[].
-- A unit has one rent (per unit/month) and may be offered for several durations
-- (e.g. {4,12} = Summer + 12-Month). Existing per-unit terms are backfilled from the
-- listing's lease_availability tags (summer=4, semester=5, 10-month=10, 12-month=12,
-- any "<n>-month" -> n). Going forward, listings.lease_availability is DERIVED from
-- these per-unit arrays.

ALTER TABLE unit_leases
  ALTER COLUMN lease_term_months TYPE integer[]
  USING (CASE WHEN lease_term_months IS NULL THEN NULL ELSE ARRAY[lease_term_months] END);

UPDATE unit_leases ul
SET lease_term_months = sub.terms
FROM (
  SELECT u.id AS unit_id,
    (SELECT array_agg(DISTINCT m ORDER BY m)
     FROM (
       SELECT CASE lower(btrim(tag))
         WHEN 'summer'   THEN 4
         WHEN 'semester' THEN 5
         WHEN '10-month' THEN 10
         WHEN '12-month' THEN 12
         ELSE NULLIF(regexp_replace(tag, '[^0-9]', '', 'g'), '')::int
       END AS m
       FROM unnest(l.lease_availability) AS tag
     ) t
     WHERE m IS NOT NULL
    ) AS terms
  FROM listing_units u
  JOIN listings l ON l.id = u.listing_id
  WHERE l.lease_availability IS NOT NULL
    AND array_length(l.lease_availability, 1) > 0
) sub
WHERE ul.unit_id = sub.unit_id
  AND sub.terms IS NOT NULL
  AND (ul.lease_term_months IS NULL OR array_length(ul.lease_term_months, 1) IS NULL);
