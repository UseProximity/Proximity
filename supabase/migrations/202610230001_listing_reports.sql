-- Listing reports.
--
-- A plain queue of reports about a listing itself (its photos, text or contact details),
-- like chat_reports and review_reports: server side only, RLS on with no policies, so who
-- reported what is never readable with the browser key.
--
-- reported_user_id is the listing's primary landlord, copied at report time so the report
-- still names them after the listing changes.
--
-- One report per reporter per listing. Idempotent / safe to re-run. Apply to BOTH dev and prod.

CREATE TABLE IF NOT EXISTS public.listing_reports (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id      uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  listing_id       uuid        NOT NULL REFERENCES public.listings(id) ON DELETE CASCADE,
  reported_user_id uuid        REFERENCES public.users(id) ON DELETE SET NULL,
  reason           text        NOT NULL,
  details          text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  reviewed_at      timestamptz,
  CONSTRAINT listing_reports_reason_check
    CHECK (reason IN ('misleading_or_fake', 'scam_or_fraud', 'inappropriate_content', 'discriminatory', 'other')),
  CONSTRAINT listing_reports_details_length_check
    CHECK (details IS NULL OR char_length(details) <= 500)
);

CREATE UNIQUE INDEX IF NOT EXISTS listing_reports_one_per_reporter
  ON public.listing_reports (reporter_id, listing_id);

CREATE INDEX IF NOT EXISTS idx_listing_reports_pending
  ON public.listing_reports (created_at DESC)
  WHERE reviewed_at IS NULL;

-- Server-only, like the other report tables: RLS on, no policies.
ALTER TABLE public.listing_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.listing_reports FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON public.listing_reports FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON public.listing_reports FROM authenticated;
  END IF;
END $$;

DO $$ BEGIN
  RAISE NOTICE 'Migration 202610230001: listing_reports added.';
END $$;
