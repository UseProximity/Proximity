-- Rename Costco if Manchester row still exists
UPDATE locations
SET name = 'Costco (Olivette)', latitude = 38.676274, longitude = -90.358976
WHERE name = 'Costco (Manchester)';

-- Or insert Olivette if you renamed manually and Manchester is gone:
INSERT INTO locations (location_type_id, name, latitude, longitude)
SELECT lt.id, 'Costco (Olivette)', 38.676274, -90.358976
FROM location_types lt WHERE lt.name = 'poi'
ON CONFLICT (name) DO NOTHING;

-- Optional cleanup: remove orphaned drive times for old Costco
DELETE FROM listing_drive_times
WHERE location_id = (SELECT id FROM locations WHERE name = 'Costco (Manchester)');