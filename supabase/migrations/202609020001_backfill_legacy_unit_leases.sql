-- ===========================================================================
-- Backfill offerings that only ever existed in the retired listing_leases table
-- ===========================================================================
--
-- APPLY THIS **BEFORE** DEPLOYING the derived-availability code, and before
-- 202609020003. It is data-only and changes nothing visible under the code
-- running today, but the new rule ("a unit with no live offering is not on the
-- market") depends on it. Ship the rule first and these eight properties go
-- dark.
--
-- WHAT HAPPENED: the bulk imports of 2026-03-31 and 2026-04-06 wrote
-- `listing_units` rows and `listing_leases` rows, and never created the
-- `unit_leases` offering that replaced the latter. `listing_leases` has been
-- retired — nothing in the app reads it — so eight live, photographed,
-- owner-confirmed properties have carried no offering the app can see since
-- March. They show no price and Proxy will not recommend them. Diffing the
-- pre-restructure backup (prod-20260830-174826) against live prod confirms the
-- restructure did not drop these: they never existed in unit_leases at all.
--
--   Kingsland Courtyard, 608 Kingsland Ave      Clocktower
--   Five-Nine, Kingsbury Ave                    Clocktower
--   University Square, 605 Leland Ave           Clocktower  (2 live units)
--   6633 / 6623 / 6655 Kingsbury Blvd           Roberts Realty
--   517 Kingsland Ave                           Roberts Realty
--   520 Westgate Ave (STUDIO ALL UTILTIES…)     independent
--
-- Expect 9 rows: 8 listings, University Square having two live unit types.
--
-- RENT IS DELIBERATELY NULL. Every one of the 19 legacy rows behind these
-- listings carries rent = 0, and 0 there is a placeholder for "unknown", not a
-- price: no unit_leases row in prod uses 0, 47 use NULL, and getListing.js
-- gates the price on `rent != null`. Writing 0 would publish a $0/mo card on
-- eight real properties. These come back visible and contactable but unpriced;
-- the actual rents have to come from Clocktower and Roberts Realty.
--
-- Restoration, not invention: the insert requires an active legacy row on the
-- listing, so it can never manufacture an offering for a listing that genuinely
-- has none. It is idempotent — a unit that already has any offering is skipped.
--
-- Applies to BOTH dev and prod (see .claude/rules/api.md).
-- ===========================================================================

BEGIN;

INSERT INTO unit_leases (
  unit_id, owner_id, rent, rent_is_per_person, lease_term_months,
  available_from, sublease, is_active, unavailable, contact_email
)
SELECT
  u.id,
  ll_primary.user_id,
  NULL,                                  -- legacy 0 means "unknown"; never write 0
  NULL,                                  -- no rent, so no basis to claim
  ARRAY[COALESCE(legacy.lease_term_months, 12)],
  legacy.available_from,                 -- NULL on every legacy row today
  COALESCE(legacy.sublease, false),
  true,
  false,
  l.contact_email
FROM listing_units u
JOIN listings l ON l.id = u.listing_id
-- the legacy offering this unit lost: prefer one of the same shape
LEFT JOIN LATERAL (
  SELECT ll.*
  FROM listing_leases ll
  WHERE ll.listing_id = l.id
    AND ll.is_active
    AND ll.deleted_at IS NULL
  ORDER BY (ll.bedrooms IS NOT DISTINCT FROM u.bedrooms) DESC,
           (ll.bathrooms IS NOT DISTINCT FROM u.bathrooms) DESC,
           ll.created_at
  LIMIT 1
) AS legacy ON true
LEFT JOIN LATERAL (
  SELECT ml.user_id
  FROM listing_landlords ml
  WHERE ml.listing_id = l.id
  ORDER BY ml.is_primary DESC NULLS LAST
  LIMIT 1
) AS ll_primary ON true
WHERE u.deleted_at IS NULL
  AND l.deleted_at IS NULL
  AND l.unavailable = false
  AND legacy.id IS NOT NULL                       -- restore only; never invent
  AND NOT EXISTS (                                -- idempotent
    SELECT 1 FROM unit_leases ul WHERE ul.unit_id = u.id
  );

-- Fail loudly rather than half-apply.
--
-- The precondition the new rule actually needs is LISTING-level: no visible
-- listing may be left with zero available units, because that is what makes a
-- property disappear from browse. It is not that every unit must carry an
-- offering — a spare unit type with nothing on offer is a normal, correct
-- "not on the market" and hides only itself. Asserting the unit-level version
-- first was wrong, and dev proved it: The Pershing (Demo) and the CI release
-- fixture each carry an extra 0-bed type with no offering and no legacy row to
-- restore, on listings whose other units are perfectly live.
DO $check$
DECLARE
  v_dark int;
BEGIN
  SELECT count(*) INTO v_dark
  FROM listings l
  WHERE l.deleted_at IS NULL
    AND l.unavailable = false
    AND EXISTS (
      SELECT 1 FROM listing_units u
      WHERE u.listing_id = l.id AND u.deleted_at IS NULL
    )
    AND NOT EXISTS (
      SELECT 1
      FROM listing_units u
      JOIN unit_leases ul ON ul.unit_id = u.id
      WHERE u.listing_id = l.id
        AND u.deleted_at IS NULL
        AND ul.is_active
        AND NOT COALESCE(ul.unavailable, false)
    );

  IF v_dark > 0 THEN
    RAISE EXCEPTION
      'backfill-legacy-unit-leases: % visible listing(s) would still have no available unit — deploying the strict availability rule would hide them. Investigate before continuing.',
      v_dark;
  END IF;
END
$check$;

COMMIT;
