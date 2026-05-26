-- Referral review enhancements (ambassador /refer flow):
--   * sub-ratings support half-stars  → integer columns widened to numeric
--   * capture unit number + landlord lead-contact details ON the review (never on listings)
--   * seed the shared "Proximity" landlord account used as the owner of stub listings
--     auto-created when a reviewed address isn't in our catalog yet

ALTER TABLE listing_reviews
  ALTER COLUMN communication_rating TYPE numeric USING communication_rating::numeric,
  ALTER COLUMN location_rating      TYPE numeric USING location_rating::numeric,
  ALTER COLUMN value_rating         TYPE numeric USING value_rating::numeric;

ALTER TABLE listing_reviews
  ADD COLUMN IF NOT EXISTS unit_number         text,
  ADD COLUMN IF NOT EXISTS landlord_name       text,
  ADD COLUMN IF NOT EXISTS landlord_email      text,
  ADD COLUMN IF NOT EXISTS landlord_phone      text,
  ADD COLUMN IF NOT EXISTS no_landlord_contact boolean DEFAULT false;

-- Shared placeholder landlord attached to student-submitted stub listings.
INSERT INTO users (email, name, role_id, profile_complete)
SELECT 'info@proximity.org', 'Proximity',
       (SELECT id FROM roles WHERE name = 'landlord'), true
WHERE NOT EXISTS (SELECT 1 FROM users WHERE email = 'info@proximity.org');
