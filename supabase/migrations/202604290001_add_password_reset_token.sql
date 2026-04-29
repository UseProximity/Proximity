ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_token       text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_expires_at  timestamptz;

CREATE INDEX IF NOT EXISTS idx_users_password_reset_token
  ON users (password_reset_token)
  WHERE password_reset_token IS NOT NULL;
