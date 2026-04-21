-- Attaches action_log triggers to lookup tables, users, schools, and locations.

DO $$
DECLARE
  tbl text;
  tables text[] := ARRAY[
    'roles','home_types','lease_structures','metric_types','interaction_types',
    'thread_types','tags','location_types','priority_types',
    'users','schools','locations'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_action_log_%1$s ON %1$I;
       CREATE TRIGGER trg_action_log_%1$s
         AFTER INSERT OR UPDATE OR DELETE ON %1$I
         FOR EACH ROW EXECUTE FUNCTION fn_action_log();',
      tbl
    );
  END LOOP;
  RAISE NOTICE 'Migration 0006: action_log triggers attached to % tables.', array_length(tables, 1);
END $$;
