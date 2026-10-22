-- Drafts: a property, unit or lease can exist before students can see it.
--
-- Landlords want to review what the website importer read, and to add a unit or
-- an offering to a building that is already live without a half-filled row
-- going public while they type. Each level gets its own published_at:
--
--   NULL      a draft. Only its owners see it, on the dashboard.
--   a time    published. Visible to students when everything above it is too.
--
-- So a draft lease on a live unit hides only that lease, a draft unit hides the
-- unit and its leases, and a draft property hides the whole tree. The read
-- paths check all three (see lib/listings/unitAvailability.js).
--
-- Publishing is one-way. Once something has been in front of students it never
-- returns to draft: hiding a live offering is what Withdraw is for, and keeping
-- the two apart means "draft" always means "never shown". The trigger below
-- holds that line for every writer, including the generic admin table editor.
--
-- The default is now(), so every existing create path (addListing, PMS sync,
-- review stubs, admin) keeps publishing immediately. Only callers that ask for
-- a draft get one. Existing rows take the migration time through the column
-- default, which avoids an UPDATE (and with it the updated_at and aggregate
-- triggers, and the check constraint three Aug 31 unit rows already fail).
--
-- Idempotent. Apply to BOTH dev and prod.

ALTER TABLE listings      ADD COLUMN IF NOT EXISTS published_at timestamptz DEFAULT now();
ALTER TABLE listing_units ADD COLUMN IF NOT EXISTS published_at timestamptz DEFAULT now();
ALTER TABLE unit_leases   ADD COLUMN IF NOT EXISTS published_at timestamptz DEFAULT now();

COMMENT ON COLUMN listings.published_at IS
  'NULL = draft, visible only to its owners. Set once on publish, never cleared.';
COMMENT ON COLUMN listing_units.published_at IS
  'NULL = draft unit. Visible to students only when the property is published too.';
COMMENT ON COLUMN unit_leases.published_at IS
  'NULL = draft offering. Visible only when its unit and property are published too.';

CREATE OR REPLACE FUNCTION keep_published()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.published_at IS NOT NULL AND NEW.published_at IS NULL THEN
    RAISE EXCEPTION 'A published % cannot return to draft', TG_TABLE_NAME
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_keep_published ON listings;
CREATE TRIGGER trg_keep_published BEFORE UPDATE OF published_at ON listings
  FOR EACH ROW EXECUTE FUNCTION keep_published();
DROP TRIGGER IF EXISTS trg_keep_published ON listing_units;
CREATE TRIGGER trg_keep_published BEFORE UPDATE OF published_at ON listing_units
  FOR EACH ROW EXECUTE FUNCTION keep_published();
DROP TRIGGER IF EXISTS trg_keep_published ON unit_leases;
CREATE TRIGGER trg_keep_published BEFORE UPDATE OF published_at ON unit_leases
  FOR EACH ROW EXECUTE FUNCTION keep_published();

-- Drafts are looked up per owner on every dashboard load; published rows are
-- the vast majority, so only the drafts are indexed.
CREATE INDEX IF NOT EXISTS listings_drafts_idx      ON listings (id)      WHERE published_at IS NULL;
CREATE INDEX IF NOT EXISTS listing_units_drafts_idx ON listing_units (listing_id) WHERE published_at IS NULL;
CREATE INDEX IF NOT EXISTS unit_leases_drafts_idx   ON unit_leases (unit_id)   WHERE published_at IS NULL;

-- rpc_create_listing: a property created with p_listing_data.draft = true is
-- born a draft. Its units and leases take the default, so publishing the
-- property alone puts the whole tree live. Rewritten in place from the live
-- definition with the replacement asserted, as in 202610090002.
DO $migration$
DECLARE
  v_def text;
BEGIN
  v_def := pg_get_functiondef('public.rpc_create_listing'::regproc);
  v_def := replace(v_def,
    'lease_availability, unavailable, deleted_at
  )
  SELECT',
    'lease_availability, unavailable, deleted_at, published_at
  )
  SELECT');
  v_def := replace(v_def,
    'lease_availability, COALESCE(unavailable, false), deleted_at
  FROM',
    $$lease_availability, COALESCE(unavailable, false), deleted_at,
    CASE WHEN COALESCE((p_listing_data->>'draft')::boolean, false) THEN NULL ELSE now() END
  FROM$$);
  IF v_def NOT LIKE '%deleted_at, published_at%'
     OR v_def NOT LIKE $$%p_listing_data->>'draft'%$$ THEN
    RAISE EXCEPTION 'rpc_create_listing: draft support not applied';
  END IF;
  EXECUTE v_def;
END
$migration$;

-- The listing's rent, bed, bath and area ranges feed the listing page's title
-- and its Apartment JSON-LD. A draft unit or offering must not move them, so
-- they count published rows only. Otherwise as before (202604220003).
CREATE OR REPLACE FUNCTION public.sync_listing_aggregates()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_listing_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'listing_units' THEN
    v_listing_id := CASE TG_OP WHEN 'DELETE' THEN OLD.listing_id ELSE NEW.listing_id END;
  ELSIF TG_TABLE_NAME = 'unit_leases' THEN
    SELECT lu.listing_id INTO v_listing_id
    FROM listing_units lu
    WHERE lu.id = CASE TG_OP WHEN 'DELETE' THEN OLD.unit_id ELSE NEW.unit_id END;
  END IF;

  IF v_listing_id IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE listings
  SET
    min_rent      = (SELECT MIN(ul.rent) FROM unit_leases ul
                       JOIN listing_units lu ON lu.id = ul.unit_id
                       WHERE lu.listing_id = v_listing_id AND ul.is_active = true
                         AND ul.published_at IS NOT NULL AND lu.published_at IS NOT NULL),
    max_rent      = (SELECT MAX(ul.rent) FROM unit_leases ul
                       JOIN listing_units lu ON lu.id = ul.unit_id
                       WHERE lu.listing_id = v_listing_id AND ul.is_active = true
                         AND ul.published_at IS NOT NULL AND lu.published_at IS NOT NULL),
    min_bedrooms  = (SELECT MIN(bedrooms)  FROM listing_units WHERE listing_id = v_listing_id AND published_at IS NOT NULL),
    max_bedrooms  = (SELECT MAX(bedrooms)  FROM listing_units WHERE listing_id = v_listing_id AND published_at IS NOT NULL),
    min_bathrooms = (SELECT MIN(bathrooms) FROM listing_units WHERE listing_id = v_listing_id AND published_at IS NOT NULL),
    max_bathrooms = (SELECT MAX(bathrooms) FROM listing_units WHERE listing_id = v_listing_id AND published_at IS NOT NULL),
    min_area      = (SELECT MIN(area)      FROM listing_units WHERE listing_id = v_listing_id AND published_at IS NOT NULL),
    max_area      = (SELECT MAX(area)      FROM listing_units WHERE listing_id = v_listing_id AND published_at IS NOT NULL),
    updated_at    = now()
  WHERE id = v_listing_id;

  RETURN NULL;
END;
$function$;
