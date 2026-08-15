-- Unit identity: give units a human-meaningful label so a landlord attaching a
-- lease to an existing property can tell which physical unit is which.
--
-- Two columns rather than one free-text field, matching the "designator dropdown
-- + number" form control: unit_designator is the noun ("Apt", "Floor", …) and
-- unit_number is the identifier ("2W", "3"). 'Whole' means the lease covers the
-- entire property (a single-family house) and carries no number.
--
-- Backfill precedence:
--   1. A unit designator embedded in listings.address ("… Apt 1W …"), but only
--      when the listing has exactly one unit — otherwise we cannot tell which
--      unit the address referred to.
--   2. listing_units.title, when it looks like an identifier ("A1", "3E", "B12")
--      rather than a floor-plan name ("2-Bed 1-Bath", "2 bedrooms with an office").
--   3. Single-unit listings with no other signal become 'Whole'.
--   4. Anything left is deliberately NULL and reported for manual resolution —
--      guessing here would create false merges, which is the exact failure this
--      column exists to prevent.
--
-- NOTE: no unique constraint yet. It lands in the dedupe phase alongside the
-- property_key unique constraint, once duplicates and NULLs are resolved.

ALTER TABLE listing_units ADD COLUMN IF NOT EXISTS unit_designator text;
ALTER TABLE listing_units ADD COLUMN IF NOT EXISTS unit_number text;

ALTER TABLE listing_units DROP CONSTRAINT IF EXISTS listing_units_designator_check;
ALTER TABLE listing_units ADD CONSTRAINT listing_units_designator_check
  CHECK (unit_designator IS NULL OR unit_designator IN ('Apt','Unit','Suite','Floor','Room','Whole'));

-- 'Whole' covers the entire property, so it must not carry a number; any other
-- designator is meaningless without one.
ALTER TABLE listing_units DROP CONSTRAINT IF EXISTS listing_units_number_check;
ALTER TABLE listing_units ADD CONSTRAINT listing_units_number_check
  CHECK (
    unit_designator IS NULL
    OR (unit_designator = 'Whole' AND unit_number IS NULL)
    OR (unit_designator <> 'Whole' AND unit_number IS NOT NULL AND btrim(unit_number) <> '')
  );

-- ── Address extractor ────────────────────────────────────────────────────────
-- Returns {designator, number} for a unit designator embedded in a free-text
-- address, or NULL when there is none. A bare "#2W" is reported as 'Unit'.
CREATE OR REPLACE FUNCTION public.extract_unit_from_address(p_address text)
RETURNS TABLE (designator text, number text)
LANGUAGE plpgsql
IMMUTABLE
AS $function$
DECLARE
  m text[];
BEGIN
  IF p_address IS NULL THEN RETURN; END IF;

  m := regexp_match(
    lower(p_address),
    '\m(apt|apartment|unit|suite|ste|floor|flr|rm|room)\M\.?\s*([a-z0-9-]+)'
  );

  IF m IS NOT NULL THEN
    RETURN QUERY SELECT
      CASE m[1]
        WHEN 'apt'       THEN 'Apt'
        WHEN 'apartment' THEN 'Apt'
        WHEN 'unit'      THEN 'Unit'
        WHEN 'suite'     THEN 'Suite'
        WHEN 'ste'       THEN 'Suite'
        WHEN 'floor'     THEN 'Floor'
        WHEN 'flr'       THEN 'Floor'
        WHEN 'rm'        THEN 'Room'
        WHEN 'room'      THEN 'Room'
      END,
      upper(m[2]);
    RETURN;
  END IF;

  m := regexp_match(lower(p_address), '#\s*([a-z0-9-]+)');
  IF m IS NOT NULL THEN
    RETURN QUERY SELECT 'Unit'::text, upper(m[1]);
  END IF;
END;
$function$;

-- ── Backfill 1: address-embedded designator on single-unit listings ──────────
UPDATE listing_units lu
SET unit_designator = x.designator,
    unit_number     = x.number
FROM listings l, LATERAL public.extract_unit_from_address(l.address) x
WHERE lu.listing_id = l.id
  AND lu.deleted_at IS NULL
  AND l.deleted_at IS NULL
  AND lu.unit_designator IS NULL
  AND x.designator IS NOT NULL
  AND (SELECT count(*) FROM listing_units s WHERE s.listing_id = l.id AND s.deleted_at IS NULL) = 1;

-- ── Backfill 2: identifier-shaped titles ─────────────────────────────────────
-- Matches "A1", "B12", "3E", "A8A" — up to two letters, digits, up to two
-- letters, no spaces. Excludes floor-plan names, which always contain a space,
-- a dash, or the words bed/bath.
UPDATE listing_units
SET unit_designator = 'Unit',
    unit_number     = upper(btrim(title))
WHERE deleted_at IS NULL
  AND unit_designator IS NULL
  AND title IS NOT NULL
  AND btrim(title) ~ '^[A-Za-z]{0,2}[0-9]{1,4}[A-Za-z]{0,2}$'
  AND length(btrim(title)) <= 6;

-- ── Backfill 3: single-unit listings default to the whole property ───────────
UPDATE listing_units lu
SET unit_designator = 'Whole',
    unit_number     = NULL
WHERE lu.deleted_at IS NULL
  AND lu.unit_designator IS NULL
  AND (SELECT count(*) FROM listing_units s
       WHERE s.listing_id = lu.listing_id AND s.deleted_at IS NULL) = 1;

CREATE INDEX IF NOT EXISTS listing_units_identity_idx
  ON listing_units (listing_id, unit_designator, unit_number) WHERE deleted_at IS NULL;
