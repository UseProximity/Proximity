-- One name per unit.
--
-- A unit's name used to come from two places: an identity (unit_designator +
-- unit_number, shown as "Apt 617" or "Whole property") and a floor plan name
-- (title). Different screens picked different ones first, so the same unit
-- could read "Apt 617" in its heading and "1 bed, 1 bath apartment, Eden
-- layout" in its tab.
--
-- listing_units.name is now the only one the app reads or writes. It is
-- backfilled with what most screens already showed: the identity when there is
-- one, otherwise the floor plan name.
--
-- unit_designator, unit_number and title are retired, not dropped: nothing
-- reads or writes them any more, and their values stay put so this can be
-- undone. listing_reviews.unit_designator / unit_number are a different thing
-- (the unit a reviewer lived in) and are untouched.
--
-- Idempotent. Apply to BOTH dev and prod.

ALTER TABLE listing_units ADD COLUMN IF NOT EXISTS name text;

-- A name is not a bed/bath/area/rent figure, so the aggregate sync has nothing
-- to recompute, and it trips over unrelated stale rows on listings (a dangling
-- last_verified_by on dev). The updated_at triggers are off too: backfilling a
-- name is not the landlord updating their unit, and bumping every row would
-- reset "last updated" across the site. The action log stays on.
ALTER TABLE listing_units DISABLE TRIGGER trg_sync_listing_aggregates;
ALTER TABLE listing_units DISABLE TRIGGER trg_listing_units_updated_at;
ALTER TABLE listing_units DISABLE TRIGGER trg_set_updated_at_listing_units;

UPDATE listing_units
SET name = CASE
  WHEN unit_designator = 'Whole' THEN 'Whole property'
  WHEN unit_designator IS NOT NULL THEN btrim(unit_designator || ' ' || COALESCE(unit_number, ''))
  ELSE NULLIF(btrim(title), '')
END
WHERE name IS NULL
  -- Three rows on both databases (Aug 31, negative bed/bath counts) predate
  -- listing_units_counts_nonneg and fail it on ANY update, which would roll this
  -- whole backfill back. They are skipped and keep a null name.
  AND COALESCE(bedrooms, 0) >= 0 AND COALESCE(bathrooms, 0) >= 0 AND COALESCE(area, 0) >= 0;

ALTER TABLE listing_units ENABLE TRIGGER trg_sync_listing_aggregates;
ALTER TABLE listing_units ENABLE TRIGGER trg_listing_units_updated_at;
ALTER TABLE listing_units ENABLE TRIGGER trg_set_updated_at_listing_units;

COMMENT ON COLUMN listing_units.name IS
  'The unit''s name ("Apt 617", "The Loft"). The single source of truth for what a unit is called.';
COMMENT ON COLUMN listing_units.title IS
  'RETIRED 2026-10-09: superseded by name. Kept for reference; not read or written by the app.';
COMMENT ON COLUMN listing_units.unit_designator IS
  'RETIRED 2026-10-09: superseded by name. Kept for reference; not read or written by the app.';
COMMENT ON COLUMN listing_units.unit_number IS
  'RETIRED 2026-10-09: superseded by name. Kept for reference; not read or written by the app.';
