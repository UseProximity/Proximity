-- Store profile-setup and password-reset tokens only as SHA-256 hashes, and
-- split the setup token into an inline one and an emailed one.
--
-- Until now both tokens sat in users in plaintext, so anything that could read
-- users rows (the admin table view and export, the action_log audit trail, a DB
-- dump, the dev snapshot of prod) held working account-takeover credentials.
-- The app now writes hashToken(raw) (apps/web/src/lib/auth/tokenHash.js) and
-- hashes the presented token before the equality lookup.
--
-- profile_setup_token also used to be ONE value used two ways: handed back in
-- the API response to whoever typed an address into a review or waitlist form,
-- and mailed to that address, where opening it verified the email. Holding it
-- therefore "proved" an inbox the holder may never have seen. It now keeps only
-- the inline role (profile fields, no verification, no password), and the new
-- profile_setup_link_hash holds the emailed link, minted at send time. Only the
-- link verifies the address.
--
-- Existing values are hashed in place so live links keep working. They are all
-- treated as INLINE tokens, because nothing records which ones were only ever
-- emailed: such a link still opens the profile form, and the next confirmation
-- or nudge email carries a fresh link token that verifies. Setup tokens live 7
-- days and reset tokens 1 hour, so this affects only the next week's links.

ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_setup_link_hash text;

CREATE INDEX IF NOT EXISTS idx_users_profile_setup_link_hash
  ON users (profile_setup_link_hash)
  WHERE profile_setup_link_hash IS NOT NULL;

-- Raw setup tokens are already 64 hex characters (two dashless UUIDs), the same
-- shape as a hash, so nothing can tell the two apart: this UPDATE relies on the
-- migration running exactly once per database. Re-running it would hash the
-- hashes and kill this week's links (nothing worse).
UPDATE users
   SET profile_setup_token = encode(sha256(convert_to(profile_setup_token, 'UTF8')), 'hex')
 WHERE profile_setup_token IS NOT NULL;

-- Raw reset tokens are dashed UUIDs, so a hash is told apart by its shape.
UPDATE users
   SET password_reset_token = encode(sha256(convert_to(password_reset_token, 'UTF8')), 'hex')
 WHERE password_reset_token IS NOT NULL
   AND password_reset_token !~ '^[0-9a-f]{64}$';
