-- Fix typo in the shared Proximity placeholder landlord email:
--   info@proximity.org  →  info@useproximity.org
-- (Seeded by 202605250002 before the correct domain was known.)
UPDATE users
SET email = 'info@useproximity.org', updated_at = now()
WHERE email = 'info@proximity.org'
  AND NOT EXISTS (SELECT 1 FROM users WHERE email = 'info@useproximity.org');
