-- Chat (1/3): schema for listing-scoped student↔landlord messaging.
--
-- chat_threads / chat_participants / chat_messages exist since migration 0021 but have
-- never been written to (verified empty before authoring this). This adds what a real
-- listing inbox needs:
--   * chat_threads.interested_user_id — the prospective renter. The landlord side is
--     deliberately NOT stored: it's derived from listing_landlords so it can't go stale
--     when a listing changes hands.
--   * a unique partial index on (listing_id, interested_user_id) so one user can't end up
--     with two live threads about the same listing.
--   * chat_messages.message_type / metadata so richer messages (e.g. discount offers)
--     don't require another ALTER later.
--   * a trigger bumping chat_threads.updated_at on new messages — inserting a message
--     doesn't touch the thread row, so without this "sort inbox by recent activity" breaks.
--
-- Idempotent / safe to re-run. RPCs follow in 202607300002 and 202607300003.

-- ─── chat_threads ────────────────────────────────────────────────────────────
ALTER TABLE public.chat_threads
  ADD COLUMN IF NOT EXISTS interested_user_id uuid
    REFERENCES public.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_chat_threads_interested_user
  ON public.chat_threads (interested_user_id)
  WHERE deleted_at IS NULL;

-- One live thread per (listing, interested user). Partial so a soft-deleted thread doesn't
-- permanently block that user from starting a fresh conversation about the same listing.
CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_threads_listing_interested_user
  ON public.chat_threads (listing_id, interested_user_id)
  WHERE deleted_at IS NULL
    AND listing_id IS NOT NULL
    AND interested_user_id IS NOT NULL;

-- ─── chat_messages ───────────────────────────────────────────────────────────
ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS message_type text  NOT NULL DEFAULT 'text',
  ADD COLUMN IF NOT EXISTS metadata     jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$ BEGIN
  ALTER TABLE public.chat_messages
    ADD CONSTRAINT chat_messages_message_type_check
    CHECK (message_type IN ('text', 'discount_offer'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Backstop for the same limit the send RPCs enforce, so a direct or admin write can't
-- store an unbounded body.
DO $$ BEGIN
  ALTER TABLE public.chat_messages
    ADD CONSTRAINT chat_messages_body_length_check
    CHECK (char_length(body) <= 5000);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── reference data ──────────────────────────────────────────────────────────
-- 'direct' is seeded in migration 0002; re-assert it so the RPCs never depend on seed
-- state for a thread_type_id.
INSERT INTO public.thread_types (name, description)
SELECT 'direct', 'Direct conversation between two users'
WHERE NOT EXISTS (SELECT 1 FROM public.thread_types WHERE name = 'direct');

-- ─── updated_at bump on new message ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_bump_chat_thread_on_message()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.chat_threads
  SET updated_at = now()
  WHERE id = NEW.thread_id;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_bump_chat_thread_on_message ON public.chat_messages;
CREATE TRIGGER trg_bump_chat_thread_on_message
  AFTER INSERT ON public.chat_messages
  FOR EACH ROW EXECUTE FUNCTION public.fn_bump_chat_thread_on_message();

DO $$ BEGIN
  RAISE NOTICE 'Migration 202607300001: chat schema (interested_user_id, message_type/metadata, uniqueness, updated_at trigger) applied.';
END $$;