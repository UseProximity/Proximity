-- fn_action_log previously required NEW.id to exist on every triggered table.
-- Tables with a non-surrogate PK (listing_amenities, listing_utilities with PK listing_id;
-- chat_participants with PK (thread_id, user_id); dorm_review_tags with PK (review_id, tag_id))
-- returned NULL for NEW.id, violating action_log.record_id NOT NULL on every write.
-- Most visibly: landlord listing edits upsert listing_amenities and listing_utilities,
-- failing the entire PATCH.
--
-- Fix: fall back to gen_random_uuid() when the row has no `id`. Full PK values are still
-- preserved in old_data/new_data jsonb, so audit traceability is retained.

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

  -- Resolve record_id: prefer surrogate `id`, else fall back to gen_random_uuid().
  -- Tables without an `id` column still need a non-null record_id to satisfy the
  -- action_log schema; their real PK lives in old_data/new_data.
  BEGIN
    IF TG_OP = 'DELETE' THEN
      v_record_id := (v_old_data->>'id')::uuid;
    ELSE
      v_record_id := (v_new_data->>'id')::uuid;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_record_id := NULL;
  END;

  IF v_record_id IS NULL THEN
    v_record_id := gen_random_uuid();
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

DO $$ BEGIN RAISE NOTICE 'Migration 202604220002: fn_action_log now tolerates tables without an id column.'; END $$;
