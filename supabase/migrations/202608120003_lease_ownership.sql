-- Ownership moves from the listing to the lease.
--
-- Previously one listing row was simultaneously the property, the content, and
-- the ownership boundary, so two landlords could not offer leases at the same
-- address without duplicating the property. Ownership now lives on unit_leases:
-- one lease = one owner's offering on one unit.
--
-- Split (property stays shared, offering is private):
--   PROPERTY (listings)   address, coordinates, walk/drive times, reviews,
--                         building amenities
--   OFFERING (unit_leases) owner, contact, description, rent, term, furnished,
--                         availability, photos
--
-- listing_landlords is now DERIVED — the set of distinct unit_leases.owner_id at
-- a property — rather than the source of truth. It is left in place so existing
-- reads keep working; the code migration retires it.
--
-- Photos: rather than duplicating image rows per lease, listing_images gains an
-- owner_id. NULL means property-level (Street View, building exterior) and is
-- visible on every offering; a set owner_id means that owner's own photography
-- and is visible only on their leases. This is what stops a landlord's photos
-- from being inherited by someone who later attaches a sublease to the property.

-- ── Ownership + contact ──────────────────────────────────────────────────────
ALTER TABLE unit_leases ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES users(id);
ALTER TABLE unit_leases ADD COLUMN IF NOT EXISTS contact_name  text;
ALTER TABLE unit_leases ADD COLUMN IF NOT EXISTS contact_email text;
ALTER TABLE unit_leases ADD COLUMN IF NOT EXISTS contact_phone text;

-- ── Offering content ─────────────────────────────────────────────────────────
ALTER TABLE unit_leases ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE unit_leases ADD COLUMN IF NOT EXISTS furnished boolean;

-- Per-offering availability, so one owner marking their lease unavailable does
-- not take the whole property down with it.
ALTER TABLE unit_leases ADD COLUMN IF NOT EXISTS unavailable boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS unit_leases_owner_idx ON unit_leases (owner_id);

-- ── Photo attribution ────────────────────────────────────────────────────────
ALTER TABLE listing_images ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES users(id);
CREATE INDEX IF NOT EXISTS listing_images_owner_idx ON listing_images (listing_id, owner_id);

-- ── Backfill: ownership from listing_landlords ───────────────────────────────
-- Prefer the primary landlord; fall back to any landlord on the listing.
--
-- The JOIN to users is deliberate: listing_landlords can reference users that no
-- longer exist (deleted accounts, and inbound FKs dropped by the prod->dev
-- snapshot). Those leases are left with a NULL owner and reported by the
-- verification query rather than being attributed to a fabricated user.
UPDATE unit_leases ul
SET owner_id = COALESCE(
      (SELECT ll.user_id FROM listing_landlords ll
       JOIN users u ON u.id = ll.user_id
       WHERE ll.listing_id = lu.listing_id AND ll.is_primary
       ORDER BY ll.created_at LIMIT 1),
      (SELECT ll.user_id FROM listing_landlords ll
       JOIN users u ON u.id = ll.user_id
       WHERE ll.listing_id = lu.listing_id
       ORDER BY ll.created_at LIMIT 1)
    )
FROM listing_units lu
WHERE ul.unit_id = lu.id
  AND ul.owner_id IS NULL;

-- ── Backfill: contact + content from the listing ─────────────────────────────
--
-- The content columns are COALESCE(ul.x, l.x) — fill only what the offering has
-- not got. `unavailable` cannot use that shape: it is NOT NULL DEFAULT false, so
-- ul.unavailable is never null and COALESCE would always choose it, leaving the
-- column stuck at false and never carrying hiddenness down at all.
--
-- So it ORs instead, which is one-directional on purpose. A property that is
-- hidden hides its offerings; an offering its owner has withdrawn is never put
-- back on sale.
--
-- On the first run the two are the same statement: the column has just been
-- created and every row is false, and `X OR false` is `X`. The OR only matters
-- if this ever runs a second time, and then it is the difference between
-- carrying hiddenness down and republishing withdrawn listings — re-running the
-- plain assignment against dev today puts 20 offerings back on sale, including
-- real subletters' rooms.
--
-- Consequence worth stating: un-hiding a property no longer re-lists every
-- offering on it. Relisting is each owner's decision now, made on their own
-- lease.
UPDATE unit_leases ul
SET contact_name  = COALESCE(ul.contact_name,  l.contact_name),
    contact_email = COALESCE(ul.contact_email, l.contact_email),
    contact_phone = COALESCE(ul.contact_phone, l.contact_phone),
    description   = COALESCE(ul.description,   l.description),
    furnished     = COALESCE(ul.furnished,     l.furnished),
    unavailable   = COALESCE(l.unavailable, false) OR ul.unavailable
FROM listing_units lu
JOIN listings l ON l.id = lu.listing_id
WHERE ul.unit_id = lu.id;

-- ── Backfill: attribute existing user photos to the listing's owner ──────────
-- Street View photos (source = 'street_view') stay NULL = property-level, so
-- every offering at the property keeps a default image. User uploads become the
-- uploading owner's private photos.
UPDATE listing_images li
SET owner_id = COALESCE(
      (SELECT ll.user_id FROM listing_landlords ll
       JOIN users u ON u.id = ll.user_id
       WHERE ll.listing_id = li.listing_id AND ll.is_primary
       ORDER BY ll.created_at LIMIT 1),
      (SELECT ll.user_id FROM listing_landlords ll
       JOIN users u ON u.id = ll.user_id
       WHERE ll.listing_id = li.listing_id
       ORDER BY ll.created_at LIMIT 1)
    )
WHERE li.owner_id IS NULL
  AND li.source IS DISTINCT FROM 'street_view';
