-- Creates matchmaking_preferences + matchmaking_priority_mappings,
-- migrates from matchmaking_responses.
-- matchmaking_responses is preserved (not dropped) until all API routes are updated.

-- Add move_in_date columns to source table (were in the API but never added to DB).
ALTER TABLE matchmaking_responses ADD COLUMN IF NOT EXISTS move_in_date_earliest date;
ALTER TABLE matchmaking_responses ADD COLUMN IF NOT EXISTS move_in_date_latest   date;

CREATE TABLE IF NOT EXISTS matchmaking_preferences (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  budget_min            numeric(10,2),
  budget_max            numeric(10,2),
  move_in_date_earliest date,
  move_in_date_latest   date,
  lease_term            text,
  furnished             boolean,
  group_size            integer,
  student_type          text,
  area                  text,
  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);

CREATE TABLE IF NOT EXISTS matchmaking_priority_mappings (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  preference_id    uuid NOT NULL REFERENCES matchmaking_preferences(id) ON DELETE CASCADE,
  priority_type_id uuid NOT NULL REFERENCES priority_types(id),
  rank             integer NOT NULL CHECK (rank > 0),
  weight           numeric(4,2) NOT NULL DEFAULT 1.0 CHECK (weight >= 0 AND weight <= 10),
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (preference_id, priority_type_id)
);

-- Migrate matchmaking_responses → matchmaking_preferences.
-- budget is a single text/numeric field; map to budget_max.
INSERT INTO matchmaking_preferences (
  user_id, budget_max, move_in_date_earliest, move_in_date_latest,
  lease_term, furnished, group_size, student_type, area, notes, created_at
)
SELECT
  mr.user_id,
  CASE WHEN mr.budget ~ '^\d+(\.\d+)?$' THEN mr.budget::numeric ELSE NULL END,
  mr.move_in_date_earliest,
  mr.move_in_date_latest,
  mr.lease_term,
  CASE LOWER(TRIM(mr.furnished))
    WHEN 'yes' THEN true  WHEN 'true'        THEN true  WHEN '1'           THEN true
    WHEN 'furnished'   THEN true
    WHEN 'no'  THEN false WHEN 'false'       THEN false WHEN '0'           THEN false
    WHEN 'unfurnished' THEN false
    ELSE NULL
  END,
  CASE WHEN mr.group_size ~ '^\d+$' THEN mr.group_size::integer ELSE NULL END,
  mr.student_type,
  mr.area,
  mr.notes,
  mr.created_at
FROM matchmaking_responses mr
WHERE mr.user_id IS NOT NULL
ON CONFLICT (user_id) DO NOTHING;

-- Migrate priorities text[] → matchmaking_priority_mappings (rank = array position).
INSERT INTO matchmaking_priority_mappings (preference_id, priority_type_id, rank)
SELECT
  mp.id,
  pt.id,
  pr.rank
FROM matchmaking_responses mr
JOIN matchmaking_preferences mp ON mp.user_id = mr.user_id
JOIN LATERAL (
  SELECT elem, row_number() OVER () AS rank
  FROM unnest(mr.priorities) AS elem
) pr ON true
JOIN priority_types pt ON LOWER(pt.name) = LOWER(pr.elem)
WHERE mr.priorities IS NOT NULL
  AND array_length(mr.priorities, 1) > 0
ON CONFLICT (preference_id, priority_type_id) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_matchmaking_pref_user     ON matchmaking_preferences (user_id);
CREATE INDEX IF NOT EXISTS idx_matchmaking_priority_pref ON matchmaking_priority_mappings (preference_id, rank);
CREATE INDEX IF NOT EXISTS idx_matchmaking_priority_type ON matchmaking_priority_mappings (priority_type_id);

DO $$ DECLARE v_pref bigint; v_maps bigint;
BEGIN
  SELECT COUNT(*) INTO v_pref FROM matchmaking_preferences;
  SELECT COUNT(*) INTO v_maps FROM matchmaking_priority_mappings;
  RAISE NOTICE 'Migration 0022: % matchmaking_preferences, % priority_mappings migrated.', v_pref, v_maps;
END $$;
