-- A landlord-chosen order for the units at a property.
--
-- Every screen sorted units its own way (the student panel by beds then baths,
-- the editor in fetch order), so a landlord had no say in which unit students
-- see first. listing_units.sort_order is that say: dragging the unit tabs in
-- the editor rewrites it, and every view orders by it.
--
-- Seeded with the order students already see (beds, then baths, then age), so
-- nothing moves until a landlord drags. Units created later without one (the
-- listing RPCs, PMS sync) sort after the ordered ones, by the same fallback.
--
-- Idempotent. Apply to BOTH dev and prod.

ALTER TABLE listing_units ADD COLUMN IF NOT EXISTS sort_order integer;

-- Same reasoning as 202610090001: an order is not a bed/bath/rent figure, and
-- seeding it is not the landlord updating their unit.
ALTER TABLE listing_units DISABLE TRIGGER trg_sync_listing_aggregates;
ALTER TABLE listing_units DISABLE TRIGGER trg_listing_units_updated_at;
ALTER TABLE listing_units DISABLE TRIGGER trg_set_updated_at_listing_units;

UPDATE listing_units u
SET sort_order = s.rn
FROM (
  SELECT id,
         row_number() OVER (
           PARTITION BY listing_id
           ORDER BY COALESCE(bedrooms, 0), COALESCE(bathrooms, 0), created_at, id
         ) - 1 AS rn
  FROM listing_units
  WHERE deleted_at IS NULL
) s
WHERE u.id = s.id
  AND u.sort_order IS NULL
  -- The three Aug 31 rows with negative counts fail listing_units_counts_nonneg
  -- on any update (see 202610090001). They keep a null order and sort last.
  AND COALESCE(u.bedrooms, 0) >= 0 AND COALESCE(u.bathrooms, 0) >= 0 AND COALESCE(u.area, 0) >= 0;

ALTER TABLE listing_units ENABLE TRIGGER trg_sync_listing_aggregates;
ALTER TABLE listing_units ENABLE TRIGGER trg_listing_units_updated_at;
ALTER TABLE listing_units ENABLE TRIGGER trg_set_updated_at_listing_units;

COMMENT ON COLUMN listing_units.sort_order IS
  'Position of the unit among its property''s units, set by dragging the unit tabs. NULL sorts last, then by beds and baths.';
