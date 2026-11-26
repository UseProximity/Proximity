-- What the listing-update reader decided about each landlord chat message
-- (lib/agents/chatListingUpdates.js). Kept off chat_messages.metadata: the chat
-- feed (rpc_get_chat_messages) sends metadata to both people in the chat, and
-- these notes (the model's reasoning, scores, errors) are for admins only
-- (PR 484 review). The primary key also makes each message read once: the
-- reader claims the row before it reads.
CREATE TABLE IF NOT EXISTS public.chat_listing_reads (
  message_id uuid PRIMARY KEY REFERENCES public.chat_messages(id) ON DELETE CASCADE,
  thread_id uuid NOT NULL REFERENCES public.chat_threads(id) ON DELETE CASCADE,
  listing_id uuid,
  record jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chat_listing_reads_thread ON public.chat_listing_reads (thread_id);

-- Service role only: RLS on with no policies, and no grants to the browser roles.
ALTER TABLE public.chat_listing_reads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.chat_listing_reads FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.chat_listing_reads TO service_role;

-- A listing change read from a landlord's message to a student is its own
-- cause, apart from what a landlord tells their own agent (landlord_chat).
ALTER TABLE public.listing_fact_events DROP CONSTRAINT IF EXISTS listing_fact_events_cause_check;
ALTER TABLE public.listing_fact_events ADD CONSTRAINT listing_fact_events_cause_check CHECK (cause IN (
  'seed', 'sync', 'url_added', 'landlord_chat', 'landlord_answer', 'dashboard', 'admin',
  'document', 'backfill', 'revert', 'landlord_edit', 'student_chat'
));
