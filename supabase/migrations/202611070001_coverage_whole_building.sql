-- Exhibit A says, for each property, whether the whole building is covered or
-- only some units (Wyatt, 2026-11-07). agreement_coverage.units already holds the
-- unit names; whole_building says whether they are the whole of it. Rows from
-- before this are treated as the whole building, which is what they covered.
-- "Whole building" covers every unit, new ones too; otherwise only the listed
-- units are covered and another unit there needs an Exhibit A amendment.
ALTER TABLE public.agreement_coverage
  ADD COLUMN IF NOT EXISTS whole_building boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.agreement_coverage.whole_building IS
  'true: every unit at the address is covered, including ones added later. false: only the units in units.';

-- An amendment can now add units to a property already on Exhibit A, so a
-- property may have a live row from the agreement and one from each amendment.
-- The rule becomes one live row per document (agreement or amendment) per property.
DROP INDEX IF EXISTS public.uq_agreement_coverage_property;
CREATE UNIQUE INDEX IF NOT EXISTS uq_agreement_coverage_property
  ON public.agreement_coverage (agreement_id, listing_id, COALESCE(amendment_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE status <> 'released';
