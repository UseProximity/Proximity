-- Drops legacy action_logs (0 rows), creates v4 action_log + fn_action_log trigger function.

DROP TABLE IF EXISTS action_logs CASCADE;

CREATE TABLE IF NOT EXISTS action_log (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name        text        NOT NULL,
  record_id         uuid        NOT NULL,
  event_type        text        NOT NULL CHECK (event_type IN ('INSERT','UPDATE','DELETE')),
  changed_by_id     uuid        REFERENCES users(id) ON DELETE SET NULL,
  changed_by_source text        NOT NULL CHECK (changed_by_source IN ('user','system','migration','trigger')),
  old_data          jsonb,
  new_data          jsonb,
  changed_fields    jsonb,
  changed_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_action_log_table_record ON action_log (table_name, record_id);
CREATE INDEX IF NOT EXISTS idx_action_log_changed_by   ON action_log (changed_by_id);
CREATE INDEX IF NOT EXISTS idx_action_log_changed_at   ON action_log (changed_at);
CREATE INDEX IF NOT EXISTS idx_action_log_event_type   ON action_log (event_type);

CREATE OR REPLACE FUNCTION fn_action_log()
RETURNS TRIGGER AS $$
DECLARE
  v_changed_by_id     uuid;
  v_changed_by_source text;
  v_old_data          jsonb;
  v_new_data          jsonb;
  v_changed_fields    jsonb := '{}'::jsonb;
  v_key               text;
  v_old_val           jsonb;
  v_new_val           jsonb;
BEGIN
  -- Guard: never recurse into action_log itself.
  IF TG_TABLE_NAME = 'action_log' THEN
    RETURN NULL;
  END IF;

  -- Resolve actor from session variable, fall back to reserved system IDs.
  BEGIN
    v_changed_by_id := current_setting('app.current_user_id', true)::uuid;
    IF v_changed_by_id IS NULL THEN
      RAISE EXCEPTION 'fallback';
    END IF;
    v_changed_by_source := 'user';
  EXCEPTION WHEN OTHERS THEN
    CASE current_setting('application_name', true)
      WHEN 'migration' THEN
        v_changed_by_id     := '00000000-0000-0000-0000-000000000002';
        v_changed_by_source := 'migration';
      WHEN 'trigger' THEN
        v_changed_by_id     := '00000000-0000-0000-0000-000000000003';
        v_changed_by_source := 'trigger';
      ELSE
        v_changed_by_id     := '00000000-0000-0000-0000-000000000001';
        v_changed_by_source := 'system';
    END CASE;
  END;

  IF TG_OP = 'DELETE' THEN
    v_old_data := to_jsonb(OLD);
  ELSIF TG_OP = 'INSERT' THEN
    v_new_data := to_jsonb(NEW);
  ELSE
    v_old_data := to_jsonb(OLD);
    v_new_data := to_jsonb(NEW);
    FOR v_key IN SELECT jsonb_object_keys(v_new_data) LOOP
      v_old_val := v_old_data -> v_key;
      v_new_val := v_new_data -> v_key;
      IF v_old_val IS DISTINCT FROM v_new_val THEN
        v_changed_fields := v_changed_fields || jsonb_build_object(
          v_key, jsonb_build_object('old', v_old_val, 'new', v_new_val)
        );
      END IF;
    END LOOP;
    -- Guard: skip logging if nothing actually changed.
    IF v_changed_fields = '{}'::jsonb THEN
      RETURN NULL;
    END IF;
  END IF;

  INSERT INTO action_log (
    table_name, record_id, event_type,
    changed_by_id, changed_by_source,
    old_data, new_data, changed_fields
  ) VALUES (
    TG_TABLE_NAME,
    CASE TG_OP WHEN 'DELETE' THEN (v_old_data->>'id')::uuid
               ELSE (v_new_data->>'id')::uuid END,
    TG_OP,
    v_changed_by_id,
    v_changed_by_source,
    v_old_data,
    v_new_data,
    CASE TG_OP WHEN 'UPDATE' THEN v_changed_fields ELSE NULL END
  );

  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DO $$ BEGIN RAISE NOTICE 'Migration 0005: action_log table and fn_action_log() created.'; END $$;
