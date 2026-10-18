-- Adds McKelvey Hall as a campus place. Walk times are backfilled per listing
-- by POST /api/admin/update-campus-walk-times (only fills missing rows).

INSERT INTO locations (location_type_id, name, latitude, longitude)
SELECT lt.id, 'McKelvey Hall', 38.6482445, -90.3015144
FROM location_types lt
WHERE lt.name = 'campus'
ON CONFLICT (name) DO NOTHING;
