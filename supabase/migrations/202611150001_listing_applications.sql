-- Apply on a listing (Wyatt, 2026-11-14).
--
-- A landlord pastes the link to their own application (their portal, a form,
-- anything https). Students see an Apply button beside Tour, or beside Send
-- message where Proxy is off, only when a link is there. We never host or
-- submit the application ourselves.
--
-- ── unit_leases.application_url ─────────────────────────────────────────────
--   One per landlord per property, set in the landlord's contact block and
--   copied onto every lease they own there, the same way contact_email is.
--   NULL means no link: no Apply button for that landlord's leases.
--
-- ── listing_applications ────────────────────────────────────────────────────
--   Who went to apply. One row per student per application link on a listing:
--     started       the student clicked Apply (click_count counts repeats)
--     applied       the student told us they submitted it
--     not_applying  the student told us they are not applying
--   We cannot see inside the landlord's portal, so "applied" is the student's
--   own answer to "Did you submit your application?" on their next visit.
--
-- Server-side only (service role). Idempotent. Apply to BOTH dev and prod.

ALTER TABLE public.unit_leases
  ADD COLUMN IF NOT EXISTS application_url text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'unit_leases_application_url_check'
  ) THEN
    ALTER TABLE public.unit_leases
      ADD CONSTRAINT unit_leases_application_url_check
      CHECK (application_url IS NULL OR (application_url ~* '^https://' AND length(application_url) <= 2000));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.listing_applications (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id       uuid NOT NULL REFERENCES public.listings(id) ON DELETE CASCADE,
  student_id       uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  landlord_id      uuid REFERENCES public.users(id) ON DELETE SET NULL,
  lease_id         uuid REFERENCES public.unit_leases(id) ON DELETE SET NULL,
  application_url  text NOT NULL CHECK (length(application_url) <= 2000),
  status           text NOT NULL DEFAULT 'started' CHECK (status IN ('started', 'applied', 'not_applying')),
  click_count      integer NOT NULL DEFAULT 1,
  first_clicked_at timestamptz NOT NULL DEFAULT now(),
  last_clicked_at  timestamptz NOT NULL DEFAULT now(),
  answered_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (listing_id, student_id, application_url)
);

CREATE INDEX IF NOT EXISTS listing_applications_listing_idx ON public.listing_applications (listing_id);
CREATE INDEX IF NOT EXISTS listing_applications_landlord_idx ON public.listing_applications (landlord_id);
CREATE INDEX IF NOT EXISTS listing_applications_student_idx ON public.listing_applications (student_id);

ALTER TABLE public.listing_applications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.listing_applications FROM anon, authenticated;
