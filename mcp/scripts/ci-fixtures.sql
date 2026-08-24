-- Purpose-built test data for the release review, seeded fresh each run.
--
-- The review has to tell a human "log in as X, go here, expect Y". It cannot do
-- that against real rows: the dev database is a snapshot of production, so the
-- accounts in it belong to actual students and landlords, and their data shifts
-- under every snapshot. So the reviewer gets its OWN cast — synthetic users at a
-- synthetic address, rebuilt on every run, sharing one well-known password
-- because none of them can reach anything real.
--
-- Everything is namespaced (emails ci-fixture-*, address 1 CI Fixture Way) and
-- deleted before it is recreated, so the database holds at most one set and a
-- rerun never accumulates.
--
-- The single property below is shaped to exercise the model's hard parts at
-- once: one unit carrying three competing landlords, a withdrawn offering, an
-- unpriced unit, and photos owned by someone who does not own the building.

\set ON_ERROR_STOP on

BEGIN;

-- ── Tear down the previous run ───────────────────────────────────────────────
-- Children first; listing_images and unit_leases have no cascade from listings.
DELETE FROM listing_images  WHERE listing_id IN (SELECT id FROM listings WHERE address = '1 CI Fixture Way, St. Louis, MO 63130');
DELETE FROM unit_leases     WHERE unit_id IN (SELECT u.id FROM listing_units u JOIN listings l ON l.id = u.listing_id WHERE l.address = '1 CI Fixture Way, St. Louis, MO 63130');
DELETE FROM listing_units   WHERE listing_id IN (SELECT id FROM listings WHERE address = '1 CI Fixture Way, St. Louis, MO 63130');
DELETE FROM listing_landlords WHERE listing_id IN (SELECT id FROM listings WHERE address = '1 CI Fixture Way, St. Louis, MO 63130');
DELETE FROM listings        WHERE address = '1 CI Fixture Way, St. Louis, MO 63130';
-- The ACCOUNTS are deliberately not dropped. They also live on prod, so the
-- prod→dev snapshot restores them; deleting and recreating here would churn
-- their ids for no reason and briefly break a link someone was following.

-- ── The cast ─────────────────────────────────────────────────────────────────
-- One shared password. pgcrypto's bcrypt is the same format bcryptjs verifies,
-- which is what NextAuth checks against users.password_hash.
--
-- Upserted, not recreated. These four accounts also exist on PROD so that the
-- prod→dev snapshot — which drops and replaces dev's whole public schema —
-- preserves them; guest@proximity.test was lost exactly this way. Here we only
-- reassert the password and role in case a snapshot brought an older row.
INSERT INTO users (name, email, password_hash, role_id, email_verified, profile_complete)
SELECT v.name, v.email, crypt('testing-password-2026', gen_salt('bf', 12)), r.id, true, true
FROM (VALUES
  ('CI Owner',    'ci-fixture-owner@proximity.test',   'landlord'),
  ('CI Subletter','ci-fixture-sublet@proximity.test',  'landlord'),
  ('CI Rival',    'ci-fixture-rival@proximity.test',   'landlord'),
  ('CI Student',  'ci-fixture-student@wustl.edu',      'student')
) AS v(name, email, role) JOIN roles r ON r.name = v.role
ON CONFLICT (email) DO UPDATE
  SET password_hash  = EXCLUDED.password_hash,
      role_id        = EXCLUDED.role_id,
      email_verified = true,
      name           = EXCLUDED.name;

-- ── The property ─────────────────────────────────────────────────────────────
INSERT INTO listings (title, address, city, state, zipcode, latitude, longitude,
                      description, lease_type, furnished, unavailable)
VALUES ('[CI FIXTURE] Release Test Property', '1 CI Fixture Way, St. Louis, MO 63130',
        'St. Louis', 'MO', '63130', 38.6570, -90.3050,
        'Seeded by the release review. Safe to ignore — rebuilt every run.',
        'Standard', false, false);

INSERT INTO listing_landlords (listing_id, user_id, is_primary)
SELECT l.id, u.id, true FROM listings l, users u
WHERE l.address = '1 CI Fixture Way, St. Louis, MO 63130'
  AND u.email = 'ci-fixture-owner@proximity.test';

-- Apt 101 — one unit, three landlords competing on it.
-- Apt 102 — a single offering the owner has withdrawn.
-- Apt 103 — a real unit nobody is currently offering (no price at all).
INSERT INTO listing_units (listing_id, unit_designator, unit_number, bedrooms, bathrooms, area, available)
SELECT l.id, v.d, v.n, v.beds, v.baths, v.area, true
FROM listings l, (VALUES
  ('Apt','101', 2, 1.0, 900),
  ('Apt','102', 1, 1.0, 600),
  ('Apt','103', 0, 1.0, 450)
) AS v(d, n, beds, baths, area)
WHERE l.address = '1 CI Fixture Way, St. Louis, MO 63130';

-- Offerings. Order matters: the sublease guard refuses a live sublease on a unit
-- that already holds a live lease, so the sublease is written first.
INSERT INTO unit_leases (unit_id, owner_id, rent, lease_term_months, sublease, is_active, unavailable, furnished, available_from)
SELECT u.id, o.id, 1150, ARRAY[12], true, true, false, false, CURRENT_DATE + 30
FROM listing_units u JOIN listings l ON l.id = u.listing_id, users o
WHERE l.address = '1 CI Fixture Way, St. Louis, MO 63130' AND u.unit_number = '101'
  AND o.email = 'ci-fixture-sublet@proximity.test';

INSERT INTO unit_leases (unit_id, owner_id, rent, lease_term_months, sublease, is_active, unavailable, furnished, available_from)
SELECT u.id, o.id, v.rent, ARRAY[12], false, true, false, v.furn, CURRENT_DATE + 30
FROM listing_units u JOIN listings l ON l.id = u.listing_id,
     (VALUES ('ci-fixture-owner@proximity.test', 1400, false),
             ('ci-fixture-rival@proximity.test', 1325, true)) AS v(email, rent, furn)
     JOIN users o ON o.email = v.email
WHERE l.address = '1 CI Fixture Way, St. Louis, MO 63130' AND u.unit_number = '101';

-- Apt 102: withdrawn, so it must not appear as a live option anywhere.
INSERT INTO unit_leases (unit_id, owner_id, rent, lease_term_months, sublease, is_active, unavailable, furnished)
SELECT u.id, o.id, 995, ARRAY[12], false, true, true, false
FROM listing_units u JOIN listings l ON l.id = u.listing_id, users o
WHERE l.address = '1 CI Fixture Way, St. Louis, MO 63130' AND u.unit_number = '102'
  AND o.email = 'ci-fixture-owner@proximity.test';

-- ── Photos, in both scopes ───────────────────────────────────────────────────
-- Real URLs borrowed from existing rows so the images actually render. The
-- point is the SCOPE and OWNER, not the picture.
INSERT INTO listing_images (listing_id, unit_id, owner_id, url, sort_order)
SELECT l.id, NULL, o.id, src.url, src.rn - 1
FROM listings l, users o,
     (SELECT url, row_number() OVER (ORDER BY url) AS rn
      FROM listing_images WHERE url LIKE '%/5316-pershing/%' LIMIT 2) src
WHERE l.address = '1 CI Fixture Way, St. Louis, MO 63130'
  AND o.email = 'ci-fixture-owner@proximity.test';

-- Apt 101 photos interleaved between two landlords who both offer it, so the
-- per-owner reorder rule has something to bite on.
INSERT INTO listing_images (listing_id, unit_id, owner_id, url, sort_order)
SELECT l.id, u.id, o.id, src.url, (src.rn - 1) * 2
FROM listings l JOIN listing_units u ON u.listing_id = l.id, users o,
     (SELECT url, row_number() OVER (ORDER BY url) AS rn
      FROM listing_images WHERE url LIKE '%/4500-swan/%' LIMIT 2) src
WHERE l.address = '1 CI Fixture Way, St. Louis, MO 63130' AND u.unit_number = '101'
  AND o.email = 'ci-fixture-sublet@proximity.test';

INSERT INTO listing_images (listing_id, unit_id, owner_id, url, sort_order)
SELECT l.id, u.id, o.id, src.url, (src.rn - 1) * 2 + 1
FROM listings l JOIN listing_units u ON u.listing_id = l.id, users o,
     (SELECT url, row_number() OVER (ORDER BY url) AS rn
      FROM listing_images WHERE url LIKE '%/6038-westminster/%' LIMIT 2) src
WHERE l.address = '1 CI Fixture Way, St. Louis, MO 63130' AND u.unit_number = '101'
  AND o.email = 'ci-fixture-rival@proximity.test';

COMMIT;

-- ── Catalogue ────────────────────────────────────────────────────────────────
-- Emitted for the reviewer to quote: who to log in as, where to go, and what
-- each fixture is meant to demonstrate.
SELECT json_build_object(
  'password', 'testing-password-2026',
  'note', 'Seeded fresh each run. Synthetic accounts only — none can reach real snapshotted data.',
  'listingId', l.id,
  'address', l.address,
  'accounts', json_build_array(
    json_build_object('email','ci-fixture-owner@proximity.test','role','landlord',
      'is','property owner of the fixture property, and holds one offering on Apt 101',
      'can','edit/delete the listing, manage property photos, move any photo on any unit'),
    json_build_object('email','ci-fixture-sublet@proximity.test','role','landlord',
      'is','lease-only owner — offers Apt 101 but does NOT own the property record',
      'can','edit/withdraw only their own offering; add unit photos; reorder only their own'),
    json_build_object('email','ci-fixture-rival@proximity.test','role','landlord',
      'is','a second landlord competing on the SAME unit (Apt 101)',
      'can','the same as the subletter, and must NOT be able to move or delete their photos'),
    json_build_object('email','ci-fixture-student@wustl.edu','role','student',
      'is','a renter, for browse/matchmaking/contact flows','can','browse, save, contact, review')
  ),
  'units', (SELECT json_agg(json_build_object(
      'unit', u.unit_designator || ' ' || u.unit_number,
      'unitId', u.id,
      'shape', u.bedrooms || 'bd/' || u.bathrooms || 'ba',
      'demonstrates', CASE u.unit_number
        WHEN '101' THEN 'three competing live offerings on one unit, and photos owned by two different landlords'
        WHEN '102' THEN 'a withdrawn offering — must not show as a live lease anywhere'
        ELSE 'a unit with no offering at all — unpriced, must still be visible' END,
      'liveOfferings', (SELECT count(*) FROM unit_leases x WHERE x.unit_id = u.id AND x.is_active AND NOT x.unavailable),
      'photos', (SELECT count(*) FROM listing_images i WHERE i.unit_id = u.id)
    ) ORDER BY u.unit_number)
    FROM listing_units u WHERE u.listing_id = l.id),
  'propertyPhotos', (SELECT count(*) FROM listing_images i WHERE i.listing_id = l.id AND i.unit_id IS NULL),
  'deepLinks', json_build_object(
    'detailModal', '/?listing=' || l.id,
    'browsePanel', '/browse?panel=' || l.id,
    'unitTab', '/?listing=' || l.id || '&unit=<unitId from units[] above>'
  )
) AS fixtures
FROM listings l WHERE l.address = '1 CI Fixture Way, St. Louis, MO 63130';
