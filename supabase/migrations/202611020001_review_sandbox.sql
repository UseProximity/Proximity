-- Review sandbox (App Store review accounts).
--
-- Apple reviews the production build against the production database. The review
-- accounts are flagged here so the server can keep everything they do away from
-- real landlords, students and the public (the app reads the flags; see
-- apps/web/src/lib/reviewSandbox.js). Only the team sets the user flag, by SQL.
--
--   users.review_sandbox      the account is a review sandbox account.
--   listings.review_sandbox   the listing was created by one, and is hidden from
--                             browse, search, matchmaking, the sitemap and the
--                             public listing page.
--
-- The listing flag is stamped by a BEFORE INSERT trigger, inside the statement
-- that creates the row, so a sandbox listing is never visible unflagged. The
-- creating RPCs (rpc_create_listing and rpc_create_listing_v2) both call
-- set_config('app.current_user_id', p_user_id, true) before their INSERT INTO
-- listings, and that setting is transaction-local, so the trigger reads the
-- acting user from it and edits NEW before the row is written. It keys on the
-- acting user, not on listing_landlords or unit_leases, so a sublease (no
-- landlord row at insert time) is covered too. An insert with no acting user (an
-- import, an admin insert) is never stamped.
--
-- The trigger function is SECURITY DEFINER so the users lookup cannot fail for a
-- caller without read access; it is locked down per CLAUDE.md (it returns
-- trigger, so it cannot be called as an RPC, but the grants are tightened anyway).
-- A malformed setting value never blocks a listing insert: it is simply ignored.
--
-- Additive and idempotent: safe to run before or after the code that uses it.
-- Apply to BOTH dev and prod, prod before the code is released (the browse query
-- filters on listings.review_sandbox).
--
-- Rollback (nothing else depends on it until the code ships):
--   DROP TRIGGER IF EXISTS listings_stamp_review_sandbox ON public.listings;
--   DROP FUNCTION IF EXISTS public.trg_listings_stamp_review_sandbox();
--   DROP INDEX IF EXISTS public.idx_users_review_sandbox;
--   ALTER TABLE public.listings DROP COLUMN IF EXISTS review_sandbox;
--   ALTER TABLE public.users DROP COLUMN IF EXISTS review_sandbox;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS review_sandbox boolean NOT NULL DEFAULT false;

ALTER TABLE public.listings
  ADD COLUMN IF NOT EXISTS review_sandbox boolean NOT NULL DEFAULT false;

-- The sandbox set is a handful of rows; this keeps its lookup an index scan.
CREATE INDEX IF NOT EXISTS idx_users_review_sandbox
  ON public.users (id) WHERE review_sandbox;

CREATE OR REPLACE FUNCTION public.trg_listings_stamp_review_sandbox()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_actor text := nullif(current_setting('app.current_user_id', true), '');
BEGIN
  IF v_actor IS NOT NULL
     AND v_actor ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     AND EXISTS (SELECT 1 FROM public.users WHERE id = v_actor::uuid AND review_sandbox) THEN
    NEW.review_sandbox := true;
  END IF;
  RETURN NEW;
END;
$function$;

DO $$
BEGIN
  REVOKE ALL ON FUNCTION public.trg_listings_stamp_review_sandbox() FROM PUBLIC;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.trg_listings_stamp_review_sandbox() FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.trg_listings_stamp_review_sandbox() FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.trg_listings_stamp_review_sandbox() TO service_role;
  END IF;
END $$;

DROP TRIGGER IF EXISTS listings_stamp_review_sandbox ON public.listings;
CREATE TRIGGER listings_stamp_review_sandbox
  BEFORE INSERT ON public.listings
  FOR EACH ROW EXECUTE FUNCTION public.trg_listings_stamp_review_sandbox();
