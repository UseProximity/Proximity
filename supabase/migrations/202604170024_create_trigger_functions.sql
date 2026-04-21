-- Creates fn_set_updated_at() and fn_handle_user_soft_delete() trigger functions,
-- and attaches them to the appropriate tables.

-- ─── fn_set_updated_at ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  tbl  text;
  tbls text[] := ARRAY[
    'users','listings','listing_units','listing_amenities','listing_utilities',
    'listing_images','listing_reviews','unit_leases','dorms','dorm_reviews',
    'chat_threads','matchmaking_preferences'
  ];
BEGIN
  FOREACH tbl IN ARRAY tbls LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = tbl AND column_name = 'updated_at'
    ) THEN
      EXECUTE format(
        'DROP TRIGGER IF EXISTS trg_set_updated_at_%1$s ON %1$I;
         CREATE TRIGGER trg_set_updated_at_%1$s
           BEFORE UPDATE ON %1$I
           FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();',
        tbl
      );
    END IF;
  END LOOP;
  RAISE NOTICE 'Migration 0024: fn_set_updated_at triggers attached.';
END $$;

-- ─── fn_handle_user_soft_delete ──────────────────────────────────────────────
-- When a user's deleted_at is set, soft-deletes all listings they own.
CREATE OR REPLACE FUNCTION fn_handle_user_soft_delete()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
    UPDATE listings
    SET deleted_at = NEW.deleted_at
    WHERE id IN (
      SELECT listing_id FROM listing_landlords WHERE user_id = NEW.id
    )
    AND deleted_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_user_soft_delete ON users;
CREATE TRIGGER trg_user_soft_delete
  AFTER UPDATE OF deleted_at ON users
  FOR EACH ROW
  WHEN (NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL)
  EXECUTE FUNCTION fn_handle_user_soft_delete();

DO $$ BEGIN RAISE NOTICE 'Migration 0024: fn_handle_user_soft_delete trigger attached to users.'; END $$;
