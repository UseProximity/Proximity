-- Property keys stop depending on the street-type word.
--
-- The key used to expand the trailing street type to one spelling ("St" and
-- "Street" agreed), which only helps when BOTH addresses carry one. Mapbox
-- returns some streets with no type at all, so "725 Interdrive" and a student's
-- "725 Interdrive Street" got different keys, the create flow didn't recognise
-- the building, and the site ended up with two properties at one address.
--
-- The street type is now dropped instead of expanded:
--   "725 Interdrive Street, ... 63130"   -> 725 interdrive|63130
--   "725 Interdrive, ... MO 63130"       -> 725 interdrive|63130
--   "5803 Waterman Blvd Unit 1E, ... 63112" -> 5803 waterman|63112
--
-- The cost is that the same number on two streets that differ only by type
-- (Pershing Avenue and Pershing Place, say) in one zip would share a key. On
-- 2026-10-22 no live listing in prod or dev collides that way; the only new
-- match is the 725 Interdrive duplicate this fixes.
--
-- A street line that would be left with nothing but its number keeps its type
-- ("12 Avenue"), since that word is the street's whole name.
--
-- lib/waitlists.js keys its table by property_key and changes in the same
-- commit ("6650 delmar boulevard|63130" -> "6650 delmar|63130").

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

  -- Remove unit designators wherever they appear: they may sit inside the
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

  -- Drop a trailing street-type token, abbreviated or spelled out, so a street
  -- with no type matches the same street with one. Only when at least two
  -- tokens (number and name) remain.
  IF position(' ' IN v_street) > 0 THEN
    v_head := regexp_replace(v_street, '\s+\S+$', '');
    v_last := (regexp_match(v_street, '(\S+)$'))[1];

    IF position(' ' IN v_head) > 0 AND v_last IN (
      'blvd', 'boulevard', 'ave', 'av', 'avenue', 'st', 'str', 'street',
      'dr', 'drive', 'ln', 'lane', 'rd', 'road', 'ct', 'court', 'pl', 'place',
      'ter', 'terr', 'terrace', 'pkwy', 'pky', 'parkway', 'hwy', 'highway',
      'cir', 'circle', 'trl', 'trail', 'sq', 'square'
    ) THEN
      v_street := v_head;
    END IF;
  END IF;

  RETURN v_street || '|' || COALESCE(v_zip, '');
END;
$function$;

-- ── Backfill ─────────────────────────────────────────────────────────────────
-- Nearly every listing's key changes, and this is bookkeeping, not an edit: it
-- must not stamp every listing updated_at = now, write an action_log row per
-- listing, or queue listing notification events. Those triggers are paused for
-- this one statement and restored in the same transaction.
ALTER TABLE listings DISABLE TRIGGER trg_action_log_listings;
ALTER TABLE listings DISABLE TRIGGER trg_listings_updated_at;
ALTER TABLE listings DISABLE TRIGGER trg_set_updated_at_listings;
ALTER TABLE listings DISABLE TRIGGER trg_queue_listing_notification_events;

UPDATE listings SET property_key = public.normalize_property_key(address)
WHERE property_key IS DISTINCT FROM public.normalize_property_key(address);

ALTER TABLE listings ENABLE TRIGGER trg_action_log_listings;
ALTER TABLE listings ENABLE TRIGGER trg_listings_updated_at;
ALTER TABLE listings ENABLE TRIGGER trg_set_updated_at_listings;
ALTER TABLE listings ENABLE TRIGGER trg_queue_listing_notification_events;
