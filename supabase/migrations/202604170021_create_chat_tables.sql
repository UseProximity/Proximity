-- Creates chat_threads, chat_participants, and chat_messages tables.

CREATE TABLE IF NOT EXISTS chat_threads (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_type_id uuid NOT NULL REFERENCES thread_types(id),
  listing_id     uuid REFERENCES listings(id) ON DELETE SET NULL,
  subject        text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz
);

CREATE TABLE IF NOT EXISTS chat_participants (
  thread_id    uuid NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at    timestamptz NOT NULL DEFAULT now(),
  last_read_at timestamptz,
  PRIMARY KEY (thread_id, user_id)
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id  uuid NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
  sender_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  body       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_chat_threads_listing    ON chat_threads (listing_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_chat_participants_user  ON chat_participants (user_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_thread    ON chat_messages (thread_id, created_at) WHERE deleted_at IS NULL;

DO $$ BEGIN RAISE NOTICE 'Migration 0021: chat_threads, chat_participants, chat_messages created.'; END $$;
