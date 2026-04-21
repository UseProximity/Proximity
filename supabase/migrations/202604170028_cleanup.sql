-- Phase 3 cleanup — drops legacy tables whose data is now in v4 tables.
-- Pre-req: new code is deployed on main and 0025 has run.

-- user_favorites and user_contacted → migrated to user_listing_interactions (0016).
DROP TABLE IF EXISTS user_favorites CASCADE;
DROP TABLE IF EXISTS user_contacted CASCADE;

-- matchmaking_responses → migrated to matchmaking_preferences + matchmaking_priority_mappings (0022).
DROP TABLE IF EXISTS matchmaking_responses CASCADE;

-- action_logs (legacy, 0 rows) → replaced by action_log (0005).
DROP TABLE IF EXISTS action_logs CASCADE;

-- reviews was COPIED (not renamed) to listing_reviews in 0017 to keep old code working.
-- Drop the source now that main is on new code.
DROP TABLE IF EXISTS reviews CASCADE;

-- Manual snapshot of listings.landlord_id scalar values — taken before v4 work, never used
-- by any code path or migration. Safe to remove.
DROP TABLE IF EXISTS listings_landlord_id_backup CASCADE;

DO $$ BEGIN
  RAISE NOTICE 'Migration 0028: cleanup complete. Dropped user_favorites, user_contacted, matchmaking_responses, action_logs, reviews, listings_landlord_id_backup.';
END $$;
