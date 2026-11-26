-- Review sandbox listings are outside the one-name-per-school rule.
--
-- listings_unique_property_name_per_school (202608310001) allows one live listing
-- per normalized display name per school. A listing made by an App Store review
-- sandbox account (listings.review_sandbox, 202611020001) is hidden from every
-- real user, so it must never block one: without this, a real landlord naming
-- their building the same as a sandbox listing (through rpc_create_listing, the
-- PMS ingest, or a rename) would be refused with a unique violation they cannot
-- act on, even though the app-level name check already ignores sandbox listings
-- for them (lib/listings/propertyName.js).
--
-- The index is recreated with `and not review_sandbox` in its predicate. Sandbox
-- listings are then exempt from the rule, and nothing else changes: unnamed and
-- soft-deleted properties stay exempt, and NULL school_id stays one shared bucket.
-- The old index guaranteed uniqueness across every live row, so the narrower one
-- cannot fail on existing data. The drop and the create run in one transaction on
-- a table of a few hundred rows, so writes wait a few milliseconds and the rule is
-- never absent for a concurrent insert.
--
-- Idempotent: if the index already mentions review_sandbox, nothing is dropped and
-- the create is a no-op. Apply to BOTH dev and prod, dev first, before the code
-- that depends on it is released.
--
-- Rollback (restores the 202608310001 definition):
--   DROP INDEX IF EXISTS public.listings_unique_property_name_per_school;
--   CREATE UNIQUE INDEX listings_unique_property_name_per_school
--     ON public.listings (
--       coalesce(school_id, '00000000-0000-0000-0000-000000000000'::uuid),
--       normalize_property_name(title)
--     )
--     WHERE deleted_at IS NULL AND normalize_property_name(title) IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'listings_unique_property_name_per_school'
      AND indexdef NOT ILIKE '%review_sandbox%'
  ) THEN
    DROP INDEX public.listings_unique_property_name_per_school;
  END IF;

  CREATE UNIQUE INDEX IF NOT EXISTS listings_unique_property_name_per_school
    ON public.listings (
      coalesce(school_id, '00000000-0000-0000-0000-000000000000'::uuid),
      normalize_property_name(title)
    )
    WHERE deleted_at IS NULL
      AND NOT review_sandbox
      AND normalize_property_name(title) IS NOT NULL;

  COMMENT ON INDEX public.listings_unique_property_name_per_school IS
    'One display name per school. Unnamed, soft-deleted and review sandbox properties are exempt; NULL school_id is a single shared bucket.';
END $$;
