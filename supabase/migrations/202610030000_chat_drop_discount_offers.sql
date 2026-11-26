-- Chat: remove the discount-offer surface from the database.
--
-- Offers, counter-offers and broadcast-to-savers left the chat scope on
-- 2026-10-03. The app code is gone, so these functions are unreachable, and
-- leaving unreachable SECURITY DEFINER functions behind means anything holding
-- the service key can still write offer messages that no client renders.
--
-- Production never ran 202608150004, so there this is a no-op. Dev did, which
-- is why every drop is guarded.
--
-- Idempotent / safe to re-run.

-- ─── 1. rewrite any offer messages as plain text ─────────────────────────────
-- The next migration narrows the message_type CHECK to ('text','attachment'),
-- which would fail while offer rows exist. fn_chat_format_offer_body already
-- wrote a human-readable body ("Offer: $1,200/mo"), so the text survives the
-- conversion. The structured terms stay in metadata rather than being dropped,
-- so a conversation that negotiated a number does not silently lose it.
UPDATE public.chat_messages
SET message_type = 'text',
    metadata = metadata || jsonb_build_object('retiredOfferAt', now())
WHERE message_type = 'discount_offer';

-- ─── 2. drop the offer functions ─────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.rpc_send_discount_offer(uuid, uuid, numeric, text, uuid);
DROP FUNCTION IF EXISTS public.rpc_start_listing_offer(uuid, uuid, numeric, text);
DROP FUNCTION IF EXISTS public.rpc_respond_discount_offer(uuid, uuid, text, numeric, text);
DROP FUNCTION IF EXISTS public.rpc_list_listing_savers(uuid, uuid);
DROP FUNCTION IF EXISTS public.rpc_broadcast_discount_offers(uuid, uuid, numeric, text);
DROP FUNCTION IF EXISTS public.fn_chat_supersede_pending_offers(uuid, uuid);
DROP FUNCTION IF EXISTS public.fn_chat_format_offer_body(numeric, numeric);

-- Signatures drifted across revisions, so sweep anything left by name rather
-- than trusting the argument lists above to have matched.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND (p.proname LIKE '%discount_offer%'
        OR p.proname LIKE '%listing_offer%'
        OR p.proname LIKE '%listing_savers%'
        OR p.proname = 'fn_chat_format_offer_body'
        OR p.proname = 'fn_chat_supersede_pending_offers')
  LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS %s;', r.sig);
    RAISE NOTICE 'Dropped leftover offer function %', r.sig;
  END LOOP;
END $$;

DO $$ BEGIN
  RAISE NOTICE 'Migration 202610030000: discount-offer functions dropped; offer messages rewritten as text.';
END $$;
