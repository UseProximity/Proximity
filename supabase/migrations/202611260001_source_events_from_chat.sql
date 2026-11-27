-- Listing changes a landlord states in a student chat (lib/agents/chatListingUpdates.js,
-- Wyatt 2026-11-25) are recorded as listing_source_events, so they show in the
-- sync decisions lists with the same Undo. Those changes come from no website
-- monitor: monitor_id becomes optional. detail.source = 'chat' marks them.
ALTER TABLE public.listing_source_events ALTER COLUMN monitor_id DROP NOT NULL;

-- At most one change event per chat message, lease and field: a message is
-- read once, and a retry never applies the same change twice.
CREATE UNIQUE INDEX IF NOT EXISTS listing_source_events_chat_once
  ON public.listing_source_events ((detail->>'messageId'), (detail->>'leaseId'), field)
  WHERE monitor_id IS NULL AND detail->>'source' = 'chat';
