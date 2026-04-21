-- Enables Row Level Security on all user-data tables and creates access policies.
-- Uses session variable app.current_user_id set by the API layer via SET LOCAL.

-- ─── Helper functions ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_current_user_id()
RETURNS uuid AS $$
  SELECT NULLIF(current_setting('app.current_user_id', true), '')::uuid;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION fn_current_user_role()
RETURNS text AS $$
  SELECT r.name
  FROM users u
  JOIN roles r ON r.id = u.role_id
  WHERE u.id = fn_current_user_id()
  LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ─── users ───────────────────────────────────────────────────────────────────
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS users_select   ON users;
DROP POLICY IF EXISTS users_update   ON users;
DROP POLICY IF EXISTS users_insert   ON users;
CREATE POLICY users_select ON users FOR SELECT
  USING (id = fn_current_user_id() OR fn_current_user_role() = 'super' OR is_system = true);
CREATE POLICY users_update ON users FOR UPDATE
  USING (id = fn_current_user_id() OR fn_current_user_role() = 'super');
CREATE POLICY users_insert ON users FOR INSERT
  WITH CHECK (fn_current_user_role() IN ('super','system') OR fn_current_user_id() IS NULL);

-- ─── listings ────────────────────────────────────────────────────────────────
ALTER TABLE listings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS listings_select ON listings;
DROP POLICY IF EXISTS listings_insert ON listings;
DROP POLICY IF EXISTS listings_update ON listings;
DROP POLICY IF EXISTS listings_delete ON listings;
CREATE POLICY listings_select ON listings FOR SELECT USING (deleted_at IS NULL);
CREATE POLICY listings_insert ON listings FOR INSERT
  WITH CHECK (fn_current_user_role() IN ('landlord','super','student'));
CREATE POLICY listings_update ON listings FOR UPDATE
  USING (deleted_at IS NULL AND (
    fn_current_user_role() = 'super' OR
    EXISTS (SELECT 1 FROM listing_landlords WHERE listing_id = listings.id AND user_id = fn_current_user_id())
  ));
CREATE POLICY listings_delete ON listings FOR DELETE
  USING (fn_current_user_role() = 'super');

-- ─── listing child tables (landlord-writable, publicly readable) ─────────────
DO $$
DECLARE
  tbl text;
  tbls text[] := ARRAY['listing_images','listing_amenities','listing_utilities',
                        'listing_walk_times','listing_units','listing_landlords'];
BEGIN
  FOREACH tbl IN ARRAY tbls LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I_select ON %I;', tbl, tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I_write  ON %I;', tbl, tbl);
    EXECUTE format(
      'CREATE POLICY %I_select ON %I FOR SELECT USING (true);', tbl, tbl);
    EXECUTE format(
      $p$CREATE POLICY %I_write ON %I FOR ALL USING (
        fn_current_user_role() = 'super' OR
        EXISTS (SELECT 1 FROM listing_landlords ll
                WHERE ll.listing_id = %I.listing_id AND ll.user_id = fn_current_user_id())
      );$p$, tbl, tbl, tbl);
  END LOOP;
END $$;

-- ─── unit_leases (joins through listing_units to get listing_id) ─────────────
ALTER TABLE unit_leases ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS unit_leases_select ON unit_leases;
DROP POLICY IF EXISTS unit_leases_write  ON unit_leases;
CREATE POLICY unit_leases_select ON unit_leases FOR SELECT USING (true);
CREATE POLICY unit_leases_write ON unit_leases FOR ALL USING (
  fn_current_user_role() = 'super' OR
  EXISTS (
    SELECT 1 FROM listing_landlords ll
    JOIN listing_units lu ON lu.id = unit_leases.unit_id
    WHERE ll.listing_id = lu.listing_id AND ll.user_id = fn_current_user_id()
  )
);

-- ─── listing_reviews ─────────────────────────────────────────────────────────
ALTER TABLE listing_reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS listing_reviews_select ON listing_reviews;
DROP POLICY IF EXISTS listing_reviews_insert ON listing_reviews;
DROP POLICY IF EXISTS listing_reviews_update ON listing_reviews;
CREATE POLICY listing_reviews_select ON listing_reviews FOR SELECT USING (deleted_at IS NULL);
CREATE POLICY listing_reviews_insert ON listing_reviews FOR INSERT
  WITH CHECK (user_id = fn_current_user_id());
CREATE POLICY listing_reviews_update ON listing_reviews FOR UPDATE
  USING (user_id = fn_current_user_id() OR fn_current_user_role() = 'super');

-- ─── review_votes ────────────────────────────────────────────────────────────
ALTER TABLE review_votes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS review_votes_select ON review_votes;
DROP POLICY IF EXISTS review_votes_write  ON review_votes;
CREATE POLICY review_votes_select ON review_votes FOR SELECT USING (true);
CREATE POLICY review_votes_write  ON review_votes FOR ALL  USING (user_id = fn_current_user_id());

-- ─── user_listing_interactions ───────────────────────────────────────────────
ALTER TABLE user_listing_interactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS uli_select ON user_listing_interactions;
DROP POLICY IF EXISTS uli_write  ON user_listing_interactions;
CREATE POLICY uli_select ON user_listing_interactions FOR SELECT
  USING (user_id = fn_current_user_id() OR fn_current_user_role() = 'super');
CREATE POLICY uli_write  ON user_listing_interactions FOR ALL
  USING (user_id = fn_current_user_id());

-- ─── chat tables ─────────────────────────────────────────────────────────────
ALTER TABLE chat_threads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS chat_threads_select ON chat_threads;
DROP POLICY IF EXISTS chat_threads_insert ON chat_threads;
CREATE POLICY chat_threads_select ON chat_threads FOR SELECT
  USING (deleted_at IS NULL AND
    EXISTS (SELECT 1 FROM chat_participants cp
            WHERE cp.thread_id = chat_threads.id AND cp.user_id = fn_current_user_id()));
CREATE POLICY chat_threads_insert ON chat_threads FOR INSERT
  WITH CHECK (fn_current_user_id() IS NOT NULL);

ALTER TABLE chat_participants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS chat_participants_select ON chat_participants;
CREATE POLICY chat_participants_select ON chat_participants FOR SELECT
  USING (user_id = fn_current_user_id() OR
    EXISTS (SELECT 1 FROM chat_participants cp2
            WHERE cp2.thread_id = chat_participants.thread_id AND cp2.user_id = fn_current_user_id()));

ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS chat_messages_select ON chat_messages;
DROP POLICY IF EXISTS chat_messages_insert ON chat_messages;
CREATE POLICY chat_messages_select ON chat_messages FOR SELECT
  USING (deleted_at IS NULL AND
    EXISTS (SELECT 1 FROM chat_participants cp
            WHERE cp.thread_id = chat_messages.thread_id AND cp.user_id = fn_current_user_id()));
CREATE POLICY chat_messages_insert ON chat_messages FOR INSERT
  WITH CHECK (sender_id = fn_current_user_id() AND
    EXISTS (SELECT 1 FROM chat_participants cp
            WHERE cp.thread_id = chat_messages.thread_id AND cp.user_id = fn_current_user_id()));

-- ─── matchmaking ─────────────────────────────────────────────────────────────
ALTER TABLE matchmaking_preferences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS matchmaking_pref_select ON matchmaking_preferences;
DROP POLICY IF EXISTS matchmaking_pref_write  ON matchmaking_preferences;
CREATE POLICY matchmaking_pref_select ON matchmaking_preferences FOR SELECT
  USING (user_id = fn_current_user_id() OR fn_current_user_role() = 'super');
CREATE POLICY matchmaking_pref_write ON matchmaking_preferences FOR ALL
  USING (user_id = fn_current_user_id());

ALTER TABLE matchmaking_priority_mappings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS matchmaking_pm_select ON matchmaking_priority_mappings;
DROP POLICY IF EXISTS matchmaking_pm_write  ON matchmaking_priority_mappings;
CREATE POLICY matchmaking_pm_select ON matchmaking_priority_mappings FOR SELECT
  USING (EXISTS (SELECT 1 FROM matchmaking_preferences mp
                 WHERE mp.id = matchmaking_priority_mappings.preference_id
                   AND mp.user_id = fn_current_user_id())
         OR fn_current_user_role() = 'super');
CREATE POLICY matchmaking_pm_write ON matchmaking_priority_mappings FOR ALL
  USING (EXISTS (SELECT 1 FROM matchmaking_preferences mp
                 WHERE mp.id = matchmaking_priority_mappings.preference_id
                   AND mp.user_id = fn_current_user_id()));

-- ─── dorms (public read, super write) ────────────────────────────────────────
ALTER TABLE dorms ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dorms_select     ON dorms;
DROP POLICY IF EXISTS dorms_write      ON dorms;
CREATE POLICY dorms_select ON dorms FOR SELECT USING (deleted_at IS NULL);
CREATE POLICY dorms_write  ON dorms FOR ALL    USING (fn_current_user_role() = 'super');

ALTER TABLE dorm_reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dorm_reviews_select ON dorm_reviews;
DROP POLICY IF EXISTS dorm_reviews_write  ON dorm_reviews;
CREATE POLICY dorm_reviews_select ON dorm_reviews FOR SELECT USING (deleted_at IS NULL);
CREATE POLICY dorm_reviews_write  ON dorm_reviews FOR ALL
  USING (user_id = fn_current_user_id() OR fn_current_user_role() = 'super');

ALTER TABLE dorm_review_tags ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dorm_review_tags_select ON dorm_review_tags;
CREATE POLICY dorm_review_tags_select ON dorm_review_tags FOR SELECT USING (true);

ALTER TABLE dorm_room_types ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dorm_room_types_select ON dorm_room_types;
CREATE POLICY dorm_room_types_select ON dorm_room_types FOR SELECT USING (true);

-- ─── lookup / reference tables (public read, super write) ────────────────────
DO $$
DECLARE
  tbl  text;
  tbls text[] := ARRAY[
    'roles','home_types','lease_structures','metric_types','interaction_types',
    'thread_types','tags','location_types','priority_types','locations','schools'
  ];
BEGIN
  FOREACH tbl IN ARRAY tbls LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I_select     ON %I;', tbl, tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I_write_super ON %I;', tbl, tbl);
    EXECUTE format('CREATE POLICY %I_select      ON %I FOR SELECT USING (true);', tbl, tbl);
    EXECUTE format('CREATE POLICY %I_write_super ON %I FOR ALL    USING (fn_current_user_role() = ''super'');', tbl, tbl);
  END LOOP;
END $$;

DO $$ BEGIN RAISE NOTICE 'Migration 0027: RLS enabled and policies created on all tables.'; END $$;
