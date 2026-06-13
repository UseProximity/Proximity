-- Any existing unit lease with no lease term defaults to a single 10-month term, so no
-- available unit is left with empty availability (which previously borrowed another unit's).
-- Then re-derive each listing's lease_availability from the union of its units' terms so the
-- browse filter + the listing "Lease" stat stay consistent.

UPDATE unit_leases
SET lease_term_months = ARRAY[10]
WHERE lease_term_months IS NULL OR array_length(lease_term_months, 1) IS NULL;

WITH unit_terms AS (
  SELECT u.listing_id, m
  FROM listing_units u
  JOIN unit_leases ul ON ul.unit_id = u.id
  CROSS JOIN LATERAL unnest(ul.lease_term_months) AS m
  WHERE ul.lease_term_months IS NOT NULL
),
labels AS (
  SELECT listing_id, array_agg(label ORDER BY m) AS labels
  FROM (
    SELECT DISTINCT listing_id, m,
      CASE m WHEN 4 THEN 'summer' WHEN 5 THEN 'semester' ELSE m::text || '-month' END AS label
    FROM unit_terms
  ) t
  GROUP BY listing_id
)
UPDATE listings l
SET lease_availability = labels.labels
FROM labels
WHERE l.id = labels.listing_id;
