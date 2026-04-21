-- Creates user_listing_interactions and migrates from user_favorites + user_contacted.

CREATE TABLE IF NOT EXISTS user_listing_interactions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  listing_id          uuid NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  interaction_type_id uuid NOT NULL REFERENCES interaction_types(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, listing_id, interaction_type_id)
);

-- Migrate user_favorites → 'saved' interaction.
-- (interaction_types is seeded with 'saved','contacted','clicked' in migration 0002.)
INSERT INTO user_listing_interactions (user_id, listing_id, interaction_type_id)
SELECT
  uf.user_id,
  uf.listing_id,
  it.id
FROM user_favorites uf
JOIN interaction_types it ON it.name = 'saved'
ON CONFLICT (user_id, listing_id, interaction_type_id) DO NOTHING;

-- Migrate user_contacted → 'contacted' interaction.
INSERT INTO user_listing_interactions (user_id, listing_id, interaction_type_id)
SELECT
  uc.user_id,
  uc.listing_id,
  it.id
FROM user_contacted uc
JOIN interaction_types it ON it.name = 'contacted'
ON CONFLICT (user_id, listing_id, interaction_type_id) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_uli_user              ON user_listing_interactions (user_id);
CREATE INDEX IF NOT EXISTS idx_uli_listing           ON user_listing_interactions (listing_id);
CREATE INDEX IF NOT EXISTS idx_uli_type              ON user_listing_interactions (listing_id, interaction_type_id);

DO $$ DECLARE v_count bigint;
BEGIN
  SELECT COUNT(*) INTO v_count FROM user_listing_interactions;
  RAISE NOTICE 'Migration 0016: % user_listing_interactions migrated.', v_count;
END $$;
