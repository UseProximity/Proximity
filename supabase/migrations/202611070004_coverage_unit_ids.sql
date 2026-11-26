-- Coverage by unit id, not name (Wyatt, 2026-11-06, release #395 review). The
-- signed document still lists unit names, as signed; unit_ids records which
-- units those names meant, so renaming a covered unit keeps it covered and a
-- new unit given an old name is not covered. NULL (whole building, or a row from
-- before this) falls back to matching names.
ALTER TABLE public.agreement_coverage ADD COLUMN IF NOT EXISTS unit_ids uuid[];

-- Existing named-unit rows: record the units their names mean today.
UPDATE public.agreement_coverage c
   SET unit_ids = sub.ids
  FROM (
    SELECT c2.id, array_agg(u.id ORDER BY u.id) AS ids
      FROM public.agreement_coverage c2
      JOIN public.listing_units u
        ON u.listing_id = c2.listing_id
       AND u.deleted_at IS NULL
       AND coalesce(nullif(trim(u.name), ''), nullif(trim(concat_ws(' ', u.unit_designator, u.unit_number)), ''), nullif(trim(u.title), '')) IN (SELECT jsonb_array_elements_text(c2.units))
     WHERE c2.whole_building = false AND c2.unit_ids IS NULL AND jsonb_typeof(c2.units) = 'array' AND jsonb_array_length(c2.units) > 0
     GROUP BY c2.id
  ) sub
 WHERE c.id = sub.id;
