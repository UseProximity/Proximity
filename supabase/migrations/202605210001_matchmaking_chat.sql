CREATE TABLE matchmaking_chat_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status          TEXT NOT NULL DEFAULT 'in_progress'
                    CHECK (status IN ('in_progress', 'recommendations_ready', 'abandoned')),
  transcript      JSONB NOT NULL DEFAULT '[]'::jsonb,
  preferences     JSONB NOT NULL DEFAULT '{}'::jsonb,
  weights         JSONB NOT NULL DEFAULT '{}'::jsonb,
  candidates      JSONB NOT NULL DEFAULT '[]'::jsonb,
  recommendations JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_mcs_user_status ON matchmaking_chat_sessions(user_id, status);

ALTER TABLE matchmaking_chat_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY mcs_owner_all ON matchmaking_chat_sessions FOR ALL
  USING (user_id = fn_current_user_id()) WITH CHECK (user_id = fn_current_user_id());

ALTER TABLE matchmaking_preferences
  ADD COLUMN IF NOT EXISTS weights JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TRIGGER mcs_set_updated_at BEFORE UPDATE ON matchmaking_chat_sessions
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
