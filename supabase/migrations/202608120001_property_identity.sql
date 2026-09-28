-- Property identity: give every listing a normalized key derived from its address
-- so "is there already a listing at this address?" is answerable by lookup rather
-- than by fuzzy string comparison.
--
-- The key is `<street line>|<zip>` where the street line has been lowercased,
-- stripped of any unit designator ("Apt 1W", "#2W", "Unit 1E", "Floor 1"), had
-- punctuation flattened, and had its trailing street-type token expanded to a
-- canonical form (blvd -> boulevard). Unit designators are stripped because the
-- unit belongs on listing_units, not in the property address — see the companion
-- migration 202608120002_unit_identity.sql, which lifts them out into columns.
--
-- Worked example — these three all collapse to `5803 waterman boulevard|63112`:
--   "5803 Waterman Blvd Unit 1E, St. Louis, MO 63112"
--   "5803 Waterman Boulevard, Apt 1W, St. Louis, Missouri 63112, United States"
--   "5803 Waterman Boulevard, St. Louis, Missouri 63112, United States"
--
-- NOTE: the index below is deliberately NOT unique. Existing data still contains
-- genuine duplicate properties; the unique constraint lands in the dedupe phase
-- once those have been merged.

-- ── Normalizer ───────────────────────────────────────────────────────────────
-- Only the FIRST comma-separated segment is treated as the street line, which is
-- what keeps "St. Louis" from being mistaken for a "St" street suffix — the city
-- never reaches the suffix-expansion step.
CREATE OR REPLACE FUNCTION public.normalize_property_key(p_address text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $function$
DECLARE
  v_addr   text;
  v_street text;
  v_zip    text;
  v_head   text;
  v_last   text;
BEGIN
  IF p_address IS NULL OR btrim(p_address) = '' THEN
    RETURN NULL;
  END IF;

  v_addr := lower(p_address);

  -- Pull the zip from the full address before anything is stripped.
  v_zip := (regexp_match(v_addr, '\m(\d{5})(?:-\d{4})?\M'))[1];

  -- Remove unit designators wherever they appear — they may sit inside the
  -- street segment ("5803 Waterman Blvd Unit 1E") or as their own comma segment
  -- ("5803 Waterman Boulevard, Apt 1W").
  v_addr := regexp_replace(
    v_addr,
    ',?\s*(\m(apt|apartment|unit|suite|ste|floor|flr|rm|room)\M\.?\s*[a-z0-9-]+|#\s*[a-z0-9-]+)',
    '', 'g'
  );

  -- First segment is the street line; flatten punctuation and collapse spaces.
  v_street := btrim(split_part(v_addr, ',', 1));
  v_street := btrim(regexp_replace(regexp_replace(v_street, '[^a-z0-9 ]', ' ', 'g'), '\s+', ' ', 'g'));

  IF v_street = '' THEN
    RETURN NULL;
  END IF;

  -- Expand the trailing street-type token to a canonical spelling so "Blvd" and
  -- "Boulevard" agree. Single-token street lines are left alone.
  IF position(' ' IN v_street) > 0 THEN
    v_head := regexp_replace(v_street, '\s+\S+$', '');
    v_last := (regexp_match(v_street, '(\S+)$'))[1];

    v_last := CASE v_last
      WHEN 'blvd'  THEN 'boulevard'
      WHEN 'ave'   THEN 'avenue'
      WHEN 'av'    THEN 'avenue'
      WHEN 'st'    THEN 'street'
      WHEN 'str'   THEN 'street'
      WHEN 'dr'    THEN 'drive'
      WHEN 'ln'    THEN 'lane'
      WHEN 'rd'    THEN 'road'
      WHEN 'ct'    THEN 'court'
      WHEN 'pl'    THEN 'place'
      WHEN 'ter'   THEN 'terrace'
      WHEN 'terr'  THEN 'terrace'
      WHEN 'pkwy'  THEN 'parkway'
      WHEN 'pky'   THEN 'parkway'
      WHEN 'hwy'   THEN 'highway'
      WHEN 'cir'   THEN 'circle'
      WHEN 'trl'   THEN 'trail'
      WHEN 'sq'    THEN 'square'
      ELSE v_last
    END;

    v_street := v_head || ' ' || v_last;
  END IF;

  RETURN v_street || '|' || COALESCE(v_zip, '');
END;
$function$;

-- ── Column + trigger ─────────────────────────────────────────────────────────
-- Trigger-maintained rather than GENERATED so the normalizer can be improved
-- later and the column recomputed with a plain UPDATE.
ALTER TABLE listings ADD COLUMN IF NOT EXISTS property_key text;

CREATE OR REPLACE FUNCTION public.trg_listings_set_property_key()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.property_key := public.normalize_property_key(NEW.address);
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS listings_set_property_key ON listings;
CREATE TRIGGER listings_set_property_key
  BEFORE INSERT OR UPDATE OF address ON listings
  FOR EACH ROW EXECUTE FUNCTION public.trg_listings_set_property_key();

-- ── Backfill ─────────────────────────────────────────────────────────────────
UPDATE listings SET property_key = public.normalize_property_key(address)
WHERE property_key IS DISTINCT FROM public.normalize_property_key(address);

CREATE INDEX IF NOT EXISTS listings_property_key_idx
  ON listings (property_key) WHERE deleted_at IS NULL;
