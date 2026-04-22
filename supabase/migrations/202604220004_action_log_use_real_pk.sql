-- Replaces the gen_random_uuid() fallback from migration 202604220002.
-- Instead of a random UUID, fn_action_log now looks up the triggered table's
-- primary key column via pg_index and pulls the real row UUID from NEW/OLD.
-- For composite PKs, the first PK column (in definition order) is used.
-- table_name already identifies the table; no additional column needed.

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
  v_record_id         uuid;
  v_pk_col            text;
BEGIN
  IF TG_TABLE_NAME = 'action_log' THEN
    RETURN NULL;
  END IF;

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
    IF v_changed_fields = '{}'::jsonb THEN
      RETURN NULL;
    END IF;
  END IF;

  -- Look up the first PK column of the triggered table (ordered by PK definition).
  SELECT a.attname INTO v_pk_col
  FROM pg_index i
  JOIN pg_attribute a
    ON a.attrelid = i.indrelid
   AND a.attnum   = i.indkey[0]
  WHERE i.indrelid = TG_RELID
    AND i.indisprimary;

  IF v_pk_col IS NULL THEN
    -- Table has no PK; skip logging rather than fail the write.
    RETURN NULL;
  END IF;

  BEGIN
    IF TG_OP = 'DELETE' THEN
      v_record_id := (v_old_data->>v_pk_col)::uuid;
    ELSE
      v_record_id := (v_new_data->>v_pk_col)::uuid;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- PK column is not a UUID (or cast fails); skip rather than corrupt the log.
    RETURN NULL;
  END;

  IF v_record_id IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO action_log (
    table_name, record_id, event_type,
    changed_by_id, changed_by_source,
    old_data, new_data, changed_fields
  ) VALUES (
    TG_TABLE_NAME,
    v_record_id,
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

DO $$ BEGIN RAISE NOTICE 'Migration 202604220004: fn_action_log now uses the row''s real PK column.'; END $$;
