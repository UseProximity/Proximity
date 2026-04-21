-- Seeds all lookup tables. Idempotent: ON CONFLICT DO NOTHING.

INSERT INTO roles (name) VALUES
  ('student'), ('landlord'), ('super'), ('parent'), ('other'), ('system')
ON CONFLICT (name) DO NOTHING;

INSERT INTO home_types (label) VALUES
  ('Apartment'), ('House'), ('Condo'), ('Townhouse'), ('Other')
ON CONFLICT (label) DO NOTHING;

INSERT INTO lease_structures (label, duration_months) VALUES
  ('semester', NULL),
  ('10-month', 10),
  ('12-month', 12),
  ('summer',   3)
ON CONFLICT (label) DO NOTHING;

INSERT INTO metric_types (name) VALUES
  ('clicks'), ('saves'), ('contacts')
ON CONFLICT (name) DO NOTHING;

INSERT INTO interaction_types (name) VALUES
  ('saved'), ('contacted'), ('clicked')
ON CONFLICT (name) DO NOTHING;

INSERT INTO thread_types (name, description) VALUES
  ('direct',      'Human-to-human conversation, optionally about a listing'),
  ('matchmaking', 'AI-driven matchmaking chatbot session')
ON CONFLICT (name) DO NOTHING;

INSERT INTO tags (name) VALUES
  ('Central Location'),
  ('Historic'),
  ('Mixed'),
  ('Modern'),
  ('New Building'),
  ('Off-Campus'),
  ('On-Campus'),
  ('Party'),
  ('Quiet'),
  ('Quiet Floor'),
  ('Social'),
  ('Social Floor'),
  ('Study Floor')
ON CONFLICT (name) DO NOTHING;

INSERT INTO location_types (name) VALUES
  ('campus'),
  ('shuttle'),
  ('transit'),
  ('landmark')
ON CONFLICT (name) DO NOTHING;

INSERT INTO priority_types (name) VALUES
  ('distance_to_campus'),
  ('cost'),
  ('location'),
  ('furnishing'),
  ('parking'),
  ('laundry'),
  ('pet_policy'),
  ('safety'),
  ('public_transit'),
  ('utilities_included'),
  ('lease_flexibility'),
  ('size'),
  ('natural_light'),
  ('noise_level'),
  ('neighborhood_vibe')
ON CONFLICT (name) DO NOTHING;

DO $$ BEGIN RAISE NOTICE 'Migration 0002: lookup tables seeded.'; END $$;
