-- Real estate license disclosure (MREC compliance, Seth Reeder / West End, 2026-11-04).
--
-- Before a landlord can sign the commission agreement they either confirm they
-- are not a licensed real estate agent or broker, or they give the licensee's
-- details and confirm they hold a listing agreement with the owner. Missouri
-- requires a licensee's name, company and company phone on all marketing, so
-- those three are shown on every listing the landlord offers. The license
-- number is kept for our records and never shown publicly.
--
-- ── landlord_license_disclosures ────────────────────────────────────────────
-- The current answer, one row per landlord. Edited from the landlord Profile.
--
-- ── landlord_license_disclosure_history ─────────────────────────────────────
-- Append-only: every save, and every confirmation given right before signing,
-- so we can show what was declared and when.
--
-- Server-side only (service role). Idempotent. Apply to BOTH dev and prod.

CREATE TABLE IF NOT EXISTS public.landlord_license_disclosures (
  user_id                    uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  is_licensee                boolean NOT NULL,
  agent_name                 text CHECK (agent_name IS NULL OR char_length(agent_name) <= 120),
  company_name               text CHECK (company_name IS NULL OR char_length(company_name) <= 160),
  company_phone              text CHECK (company_phone IS NULL OR char_length(company_phone) <= 32),
  license_number             text CHECK (license_number IS NULL OR char_length(license_number) <= 40),
  owner_agreement_confirmed  boolean NOT NULL DEFAULT false,
  confirmed_at               timestamptz NOT NULL DEFAULT now(),
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  -- A licensee row is complete or it does not exist.
  CONSTRAINT landlord_license_disclosures_complete CHECK (
    NOT is_licensee OR (
      agent_name IS NOT NULL AND company_name IS NOT NULL AND company_phone IS NOT NULL
      AND license_number IS NOT NULL AND owner_agreement_confirmed
    )
  )
);

CREATE TABLE IF NOT EXISTS public.landlord_license_disclosure_history (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                    uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  is_licensee                boolean NOT NULL,
  agent_name                 text,
  company_name               text,
  company_phone              text,
  license_number             text,
  owner_agreement_confirmed  boolean NOT NULL DEFAULT false,
  -- 'signing': confirmed in the step right before the agreement or an amendment opened.
  -- 'profile': saved from the landlord Profile.
  source                     text NOT NULL CHECK (source IN ('signing', 'profile')),
  created_at                 timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS landlord_license_disclosure_history_user_idx
  ON public.landlord_license_disclosure_history (user_id, created_at DESC);

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['landlord_license_disclosures', 'landlord_license_disclosure_history'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', tbl);
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_action_log_%1$s ON public.%1$I;
       CREATE TRIGGER trg_action_log_%1$s AFTER INSERT OR UPDATE OR DELETE ON public.%1$I
         FOR EACH ROW EXECUTE FUNCTION fn_action_log();', tbl);
  END LOOP;
END $$;

DROP TRIGGER IF EXISTS trg_set_updated_at_landlord_license_disclosures ON public.landlord_license_disclosures;
CREATE TRIGGER trg_set_updated_at_landlord_license_disclosures
  BEFORE UPDATE ON public.landlord_license_disclosures
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
