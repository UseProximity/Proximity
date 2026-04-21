-- Attaches action_log triggers to all tables not covered in phase 1 (migration 0006).

DO $$
DECLARE
  tbl  text;
  tbls text[] := ARRAY[
    'listings','listing_units','listing_images','listing_amenities','listing_utilities',
    'listing_walk_times','unit_leases','listing_landlords','listing_metrics_daily',
    'user_listing_interactions','listing_reviews','review_votes',
    'dorms','dorm_reviews','dorm_room_types','dorm_review_tags',
    'chat_threads','chat_participants','chat_messages',
    'matchmaking_preferences','matchmaking_priority_mappings'
  ];
BEGIN
  FOREACH tbl IN ARRAY tbls LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = tbl
    ) THEN
      EXECUTE format(
        'DROP TRIGGER IF EXISTS trg_action_log_%1$s ON %1$I;
         CREATE TRIGGER trg_action_log_%1$s
           AFTER INSERT OR UPDATE OR DELETE ON %1$I
           FOR EACH ROW EXECUTE FUNCTION fn_action_log();',
        tbl
      );
    END IF;
  END LOOP;
  RAISE NOTICE 'Migration 0026: action_log triggers attached to all remaining tables.';
END $$;
