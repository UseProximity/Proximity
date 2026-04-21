-- Creates locations table and seeds all WashU campus places and shuttle stops.

CREATE TABLE IF NOT EXISTS locations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_type_id uuid NOT NULL REFERENCES location_types(id),
  name             text NOT NULL UNIQUE,
  latitude         numeric(10,7) NOT NULL,
  longitude        numeric(11,7) NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_locations_type ON locations (location_type_id);

-- Campus places
INSERT INTO locations (location_type_id, name, latitude, longitude)
SELECT lt.id, v.name, v.lat, v.lng
FROM location_types lt
CROSS JOIN (VALUES
  ('Olin Library',               38.6485150, -90.3077076),
  ('Seigle Hall',                38.6490125, -90.3123457),
  ('Schnucks (Grocery)',         38.6333359, -90.3147361),
  ('Danforth University Center', 38.6475419, -90.3103736),
  ('Sumers Rec Center',          38.6493319, -90.3147207),
  ('Village House',              38.6505694, -90.3140516),
  ('Med Campus',                 38.6385208, -90.2635520)
) AS v(name, lat, lng)
WHERE lt.name = 'campus'
ON CONFLICT (name) DO NOTHING;

-- Shuttle stops
INSERT INTO locations (location_type_id, name, latitude, longitude)
SELECT lt.id, v.name, v.lat, v.lng
FROM location_types lt
CROSS JOIN (VALUES
  ('560 Music Center',                  38.6556069, -90.3109324),
  ('801 Skinker',                       38.6360920, -90.3037310),
  ('Asbury & Forsyth',                  38.6479909, -90.3212854),
  ('Belt Avenue',                       38.6489852, -90.2781219),
  ('Big Bend & Shepley',                38.6458598, -90.3159748),
  ('Brentwood Promenade',               38.6267213, -90.3429175),
  ('Clara',                             38.6486557, -90.2830119),
  ('Clemons & Eastgate',                38.6574402, -90.3008362),
  ('Clemons & Interdrive',              38.6585233, -90.3029719),
  ('Clemons & Leland',                  38.6590460, -90.3057196),
  ('Clemons & Syracuse',                38.6591891, -90.3072295),
  ('Concordia',                         38.6346248, -90.3161045),
  ('Delmar & Skinker',                  38.6553532, -90.2994532),
  ('Delmar DivINe',                     38.6538938, -90.2792362),
  ('DeMun & Clayton',                   38.6339956, -90.3095806),
  ('Des Peres and Forest Park Parkway', 38.6491109, -90.2945894),
  ('East End Garage',                   38.6465830, -90.3041350),
  ('Eastgate',                          38.6558904, -90.3008967),
  ('Eastgate & Cates',                  38.6585149, -90.3004669),
  ('Forsyth & Jackson',                 38.6497357, -90.3301688),
  ('Galleria',                          38.6336407, -90.3461880),
  ('Goldfarb',                          38.6467012, -90.3059205),
  ('Kingsbury & Des Peres',             38.6521160, -90.2941161),
  ('Knight Center',                     38.6500582, -90.3112903),
  ('Lewis Collaborative',               38.6583968, -90.3083062),
  ('Link in the Loop',                  38.6552183, -90.2998243),
  ('Lofts Apartments',                  38.6566260, -90.3017669),
  ('Mallinckrodt Bus Plaza',            38.6470746, -90.3095687),
  ('Med School',                        38.6368819, -90.2624736),
  ('Millbrook Garage',                  38.6501161, -90.3117353),
  ('Pershing',                          38.6482064, -90.2804802),
  ('Pershing @ DeBaliviere',            38.6485532, -90.2847458),
  ('Rosebury & Skinker',                38.6371936, -90.3036746),
  ('Rosedale & Washington',             38.6541241, -90.2961008),
  ('S-40, Clocktower',                  38.6453088, -90.3129493),
  ('S-40, Habif Health',                38.6455564, -90.3155918),
  ('Skinker & FPP',                     38.6489039, -90.3009061),
  ('Skinker & Pershing',                38.6500560, -90.3005039),
  ('Snow Way',                          38.6503804, -90.3138118),
  ('South Campus',                      38.6344207, -90.3139188),
  ('Sumers Welcome Center Pavillion',   38.6472198, -90.3040283),
  ('U-City Grill',                      38.6566034, -90.3086018),
  ('Walmart',                           38.6216776, -90.3311564),
  ('Wash Ave & Kingsland',              38.6551574, -90.3091430),
  ('Washington & Des Peres',            38.6540776, -90.2947040),
  ('Washington Avenue',                 38.6548366, -90.3058752),
  ('Waterman Blvd.',                    38.6494286, -90.2803441),
  ('WC Lower Lot',                      38.6491386, -90.3285243),
  ('Westgate',                          38.6568691, -90.3044269),
  ('Westminster',                       38.6532748, -90.2965230),
  ('Westminster & Skinker',             38.6536045, -90.2998755),
  ('Whitaker Hall',                     38.6491492, -90.3036610)
) AS v(name, lat, lng)
WHERE lt.name = 'shuttle'
ON CONFLICT (name) DO NOTHING;

-- Synthetic shuttle_nearest location for migrating existing shuttle_walk_minutes values.
-- Coordinates 0,0 are a placeholder; real per-stop times calculated by update-campus-walk-times.
INSERT INTO locations (location_type_id, name, latitude, longitude)
SELECT lt.id, 'shuttle_nearest', 0.0000000, 0.0000000
FROM location_types lt WHERE lt.name = 'shuttle'
ON CONFLICT (name) DO NOTHING;

DO $$ BEGIN RAISE NOTICE 'Migration 0003: % locations seeded.',
  (SELECT COUNT(*) FROM locations); END $$;
