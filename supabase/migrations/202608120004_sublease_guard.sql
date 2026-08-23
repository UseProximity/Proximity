-- Guard: a sublease cannot be posted on a unit that is already being offered.
--
-- A sublease means someone is living in the unit under an existing lease and is
-- handing it over. So if the unit already has a live offering, a sublease on top
-- of it is contradictory — and it is the shape a bad actor would use to attach
-- themselves to someone else's property.
--
-- The rule is deliberately ASYMMETRIC:
--   * blocked  — adding a SUBLEASE to a unit that already has a live lease
--   * allowed  — adding a STANDARD lease to a unit that has a live sublease,
--                because the landlord may legitimately be advertising the next
--                lease term while the current sublet runs out
--
-- Consequence worth noting: because standard and sublease are mutually exclusive
-- on a single unit, a property showing BOTH tags always means different units
-- (unit A standard, unit B sublease), never a contested single unit.
--
-- "Live" = is_active AND NOT unavailable. An offering the owner has marked
-- unavailable no longer blocks a sublease, so a stale row cannot lock a unit out
-- of subletting forever.

CREATE OR REPLACE FUNCTION public.trg_unit_leases_sublease_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  v_conflict_id uuid;
BEGIN
  -- Only sublease rows are constrained, and only while they are live.
  IF NOT NEW.sublease OR NOT NEW.is_active OR NEW.unavailable THEN
    RETURN NEW;
  END IF;

  SELECT ul.id INTO v_conflict_id
  FROM unit_leases ul
  WHERE ul.unit_id = NEW.unit_id
    AND ul.id <> NEW.id
    AND ul.is_active
    AND NOT ul.unavailable
  LIMIT 1;

  IF v_conflict_id IS NOT NULL THEN
    RAISE EXCEPTION
      'Cannot post a sublease on a unit that already has a live lease (conflicting lease %)', v_conflict_id
      USING ERRCODE = 'check_violation',
            HINT    = 'Choose a different unit, or add this as a new unit at the property.';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS unit_leases_sublease_guard ON unit_leases;
CREATE TRIGGER unit_leases_sublease_guard
  BEFORE INSERT OR UPDATE OF unit_id, sublease, is_active, unavailable ON unit_leases
  FOR EACH ROW EXECUTE FUNCTION public.trg_unit_leases_sublease_guard();
