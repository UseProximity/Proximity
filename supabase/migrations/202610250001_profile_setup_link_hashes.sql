-- Keep every emailed profile-setup link from the last week working, not only
-- the newest.
--
-- 202610230002 gave the emailed link its own column, profile_setup_link_hash,
-- holding ONE hash. Every review confirmation and waitlist nudge minted a fresh
-- link and overwrote it, so opening any earlier email landed on
-- ?profileSetup=expired. A student who gets a confirmation on Monday and a
-- nudge on Wednesday should be able to use either.
--
-- profile_setup_link_hashes holds the SHA-256 hash of each emailed link, newest
-- last. The app appends on every send and keeps the newest 5, so the array
-- cannot grow without bound. All of them share profile_setup_expires_at
-- (refreshed on each send, 7 days), and all are cleared together when the
-- profile is finished. The lookup is an array-contains (@>) filter, served by
-- a GIN index.
--
-- The single-value column and its partial index are dropped once its hashes
-- are carried over, so links already in inboxes keep working.
--
-- fn_action_log keeps a list of secret columns it never copies into the audit
-- trail (202610230003). The new column is added to that list by patching the
-- live function definition in place, so this works whatever else has changed
-- in that function. If 202610230003 has not run yet on a database, the patch
-- is skipped: run 202610230003 first, then this one (or re-run this one after
-- it).
--
-- Safe to run right after 202610230002, and idempotent. Apply to BOTH dev and
-- prod.

ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_setup_link_hashes text[];

CREATE INDEX IF NOT EXISTS idx_users_profile_setup_link_hashes
  ON users USING gin (profile_setup_link_hashes);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'users'
       AND column_name = 'profile_setup_link_hash'
  ) THEN
    EXECUTE $sql$
      UPDATE users
         SET profile_setup_link_hashes = ARRAY[profile_setup_link_hash]
       WHERE profile_setup_link_hash IS NOT NULL
         AND profile_setup_link_hashes IS NULL
    $sql$;
  END IF;
END
$$;

DROP INDEX IF EXISTS idx_users_profile_setup_link_hash;
ALTER TABLE users DROP COLUMN IF EXISTS profile_setup_link_hash;

-- Add the new column to fn_action_log's secret list, next to the old name
-- (left in place: harmless, and it matches any log row written before today).
DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef('public.fn_action_log()'::regprocedure) INTO v_def;
  IF position('''profile_setup_link_hashes''' in v_def) = 0
     AND position('''profile_setup_link_hash'',' in v_def) > 0 THEN
    EXECUTE replace(
      v_def,
      '''profile_setup_link_hash'',',
      '''profile_setup_link_hash'', ''profile_setup_link_hashes'','
    );
  END IF;
END
$$;

-- Nothing should have logged the new column yet, but scrub it in case.
UPDATE action_log
   SET old_data       = old_data - 'profile_setup_link_hashes',
       new_data       = new_data - 'profile_setup_link_hashes',
       changed_fields = changed_fields - 'profile_setup_link_hashes'
 WHERE old_data ? 'profile_setup_link_hashes'
    OR new_data ? 'profile_setup_link_hashes'
    OR changed_fields ? 'profile_setup_link_hashes';
