-- Chat: re-key conversations from one-thread-per-listing to one-thread-per
-- (landlord, student) pair, with the listing recorded per inquiry instead.
--
-- Why this reverses 202607300001:
--   The original model made the listing the thread boundary, so a student
--   interested in three of one landlord's properties opened three
--   conversations and the landlord's inbox was a list of properties. Product
--   decision (Wyatt, 2026-10-03) is that the inbox should be a list of PEOPLE:
--   one durable conversation per pair, and a later inquiry about a different
--   property continues it with a new listing context rather than forking.
--
--   That means the landlord side has to be STORED, not derived. The earlier
--   comment argued for deriving it from listing_landlords so a thread could
--   not go stale when a listing changed hands. That reasoning does not survive
--   the re-key: the pair IS the identity now, so the thread has to keep
--   pointing at the person it was held with even after they hand the property
--   on. chat_threads.landlord_id is therefore the recorded counterparty, and
--   fn_chat_primary_landlord_id() is only consulted when routing a NEW inquiry.
--
-- Shape after this migration:
--   chat_threads.landlord_id          the landlord side of the pair (stored)
--   chat_threads.interested_user_id   the student side
--   chat_threads.listing_id           the listing that OPENED the thread, kept
--                                     only as a fallback label
--   chat_messages.listing_id          what each message is about. This is the
--                                     real listing context and what the
--                                     transcript and the emails read.
--
-- Idempotent / safe to re-run. Apply to BOTH dev and prod.

-- ─── 1. columns ──────────────────────────────────────────────────────────────
ALTER TABLE public.chat_threads
  ADD COLUMN IF NOT EXISTS landlord_id uuid
    REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS listing_id uuid
    REFERENCES public.listings(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_chat_threads_landlord
  ON public.chat_threads (landlord_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_chat_messages_listing
  ON public.chat_messages (listing_id)
  WHERE deleted_at IS NULL AND listing_id IS NOT NULL;

-- ─── 2. drop references to listings that no longer exist ─────────────────────
-- chat_threads.listing_id is declared ON DELETE SET NULL, but dev threads were
-- found pointing at hard-deleted listings: a past prod->dev snapshot dropped
-- the inbound foreign keys, rows were deleted while nothing enforced them, and
-- the constraint came back without being revalidated. The new per-message FK
-- would be the first thing to actually check these, so clear the dangling ones
-- rather than letting an old snapshot artefact fail the migration.
UPDATE public.chat_threads t
SET listing_id = NULL
WHERE t.listing_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.listings l WHERE l.id = t.listing_id);

-- ─── 3. backfill landlord_id and per-message listing ─────────────────────────
-- Existing listing threads know their listing, so the landlord is recoverable.
UPDATE public.chat_threads t
SET landlord_id = public.fn_chat_primary_landlord_id(t.listing_id)
WHERE t.landlord_id IS NULL
  AND t.listing_id IS NOT NULL
  AND t.interested_user_id IS NOT NULL;

-- Every message in a legacy thread was about that thread's listing.
UPDATE public.chat_messages m
SET listing_id = t.listing_id
FROM public.chat_threads t
WHERE m.thread_id = t.id
  AND m.listing_id IS NULL
  AND t.listing_id IS NOT NULL;

-- ─── 4. collapse pairs that the old model let fork ───────────────────────────
-- Under the per-listing key one pair could hold several live threads. The new
-- unique index would refuse to build on that, so merge them: keep the oldest
-- thread per pair, move its siblings' messages and read state across, then
-- soft-delete the siblings. Written to be correct where such rows exist, not
-- just on the current dev snapshot.
DO $$
DECLARE
  v_keep   uuid;
  v_dupes  uuid[];
  r        record;
BEGIN
  FOR r IN
    SELECT landlord_id, interested_user_id,
           array_agg(id ORDER BY created_at) AS ids
    FROM public.chat_threads
    WHERE deleted_at IS NULL
      AND landlord_id IS NOT NULL
      AND interested_user_id IS NOT NULL
    GROUP BY landlord_id, interested_user_id
    HAVING COUNT(*) > 1
  LOOP
    v_keep  := r.ids[1];
    v_dupes := r.ids[2:array_length(r.ids, 1)];

    UPDATE public.chat_messages
    SET thread_id = v_keep
    WHERE thread_id = ANY(v_dupes);

    -- Carry the most generous read position across, so merging cannot
    -- resurrect messages the user had already seen as unread.
    UPDATE public.chat_participants keep_p
    SET last_read_at = GREATEST(
      COALESCE(keep_p.last_read_at, '-infinity'::timestamptz),
      COALESCE((
        SELECT MAX(dup_p.last_read_at)
        FROM public.chat_participants dup_p
        WHERE dup_p.thread_id = ANY(v_dupes)
          AND dup_p.user_id = keep_p.user_id
      ), '-infinity'::timestamptz)
    )
    WHERE keep_p.thread_id = v_keep;

    DELETE FROM public.chat_participants WHERE thread_id = ANY(v_dupes);

    UPDATE public.chat_threads
    SET deleted_at = now()
    WHERE id = ANY(v_dupes);

    RAISE NOTICE 'Merged % duplicate thread(s) into % for pair (%, %)',
      array_length(v_dupes, 1), v_keep, r.landlord_id, r.interested_user_id;
  END LOOP;
END $$;

-- ─── 5. swap the uniqueness key ──────────────────────────────────────────────
DROP INDEX IF EXISTS public.idx_chat_threads_listing_interested_user;

-- One live conversation per pair. Partial on landlord_id IS NOT NULL, which is
-- also what scopes this to listing chat: the matchmaking threads that share
-- these tables never set a landlord, so they are untouched by this constraint.
CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_threads_landlord_interested_user
  ON public.chat_threads (landlord_id, interested_user_id)
  WHERE deleted_at IS NULL
    AND landlord_id IS NOT NULL
    AND interested_user_id IS NOT NULL;

-- ─── 6. message_type CHECK without discount_offer ────────────────────────────
-- Offers left the scope on 2026-10-03. Re-asserted here so a database that
-- already ran the offer migrations converges with a fresh install.
ALTER TABLE public.chat_messages
  DROP CONSTRAINT IF EXISTS chat_messages_message_type_check;

ALTER TABLE public.chat_messages
  ADD CONSTRAINT chat_messages_message_type_check
  CHECK (message_type IN ('text', 'attachment'));

DO $$ BEGIN
  RAISE NOTICE 'Migration 202610030001: chat threads re-keyed to (landlord, student) with per-message listing context.';
END $$;
