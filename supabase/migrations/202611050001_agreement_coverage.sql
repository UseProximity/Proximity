-- Commission agreement coverage: one master agreement per landlord with an
-- Exhibit A of covered properties, and short Exhibit A amendments for properties
-- added later (In-App Payments, decisions of 2026-11-04).
--
-- ── agreement_versions ──────────────────────────────────────────────────────
--   kind                     master | amendment. Each kind has its own live version.
--   landlord_id              null for the standard version. Set for a version
--                            negotiated with one landlord (a change request that
--                            was accepted); it is live for that landlord only.
--   commission_rate_percent  entered by the admin with the upload, filled into the
--                            document's "Commission rate" box and shown on invoices
--   provider_rate_field_id   the Documenso id of that box, found by "Check boxes"
--   change_request_id        the change request a negotiated version answers
--                            (foreign key added in 202611050003)
--   based_on_version_id      the standard version a negotiated one was edited from
--
-- ── landlord_agreements (the master agreement each landlord signs) ──────────
--   term_start, term_end     one year from signing. Coverage ends with the term.
--   exhibit                  the exact Exhibit A sent: [{ listing_id, address, units }]
--   exhibit_file_key         the Exhibit A page(s) we generated, as sent
--   signed_exhibit_file_key  the signed Exhibit A from Documenso (with its audit page)
--   provider_exhibit_item_id the Exhibit A document's id inside the Documenso envelope
--   commission_rate_percent  the rate on the version signed, frozen
--
-- ── agreement_amendments ────────────────────────────────────────────────────
-- An Exhibit A amendment: the previous and the proposed address lists, frozen
-- when it is made. sent -> signed, or sent -> voided (ended_reason says declined,
-- cancelled or replaced). One amendment in progress per landlord.
--
-- ── agreement_coverage ──────────────────────────────────────────────────────
-- Which properties a landlord's agreement covers. A row is 'proposed' while the
-- document adding it is unsigned, 'covered' once that document is signed, and
-- 'released' if the document is declined, cancelled or replaced. The database
-- refuses 'covered' unless the document is signed, so an unsigned amendment can
-- never cover a property. Whether a covered row still counts (master signed and in
-- its term) is decided in lib/billing/coverage.js.
--
-- Idempotent. Apply to BOTH dev and prod.

-- ── agreement_versions ──────────────────────────────────────────────────────
ALTER TABLE public.agreement_versions
  ADD COLUMN IF NOT EXISTS kind                    text NOT NULL DEFAULT 'master',
  ADD COLUMN IF NOT EXISTS landlord_id             uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS commission_rate_percent numeric(6,3),
  ADD COLUMN IF NOT EXISTS provider_rate_field_id  integer,
  ADD COLUMN IF NOT EXISTS change_request_id       uuid,
  ADD COLUMN IF NOT EXISTS based_on_version_id     uuid REFERENCES public.agreement_versions(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agreement_versions_kind_check') THEN
    ALTER TABLE public.agreement_versions
      ADD CONSTRAINT agreement_versions_kind_check CHECK (kind IN ('master', 'amendment'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agreement_versions_rate_check') THEN
    ALTER TABLE public.agreement_versions
      ADD CONSTRAINT agreement_versions_rate_check
      CHECK (commission_rate_percent IS NULL OR (commission_rate_percent > 0 AND commission_rate_percent <= 100));
  END IF;
END $$;

-- One live standard version per kind, and one live negotiated version per kind per landlord.
DROP INDEX IF EXISTS public.uq_agreement_versions_live;
CREATE UNIQUE INDEX IF NOT EXISTS uq_agreement_versions_live_standard
  ON public.agreement_versions (kind) WHERE status = 'live' AND landlord_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_agreement_versions_live_landlord
  ON public.agreement_versions (kind, landlord_id) WHERE status = 'live' AND landlord_id IS NOT NULL;

-- ── landlord_agreements ─────────────────────────────────────────────────────
ALTER TABLE public.landlord_agreements
  ADD COLUMN IF NOT EXISTS term_start               timestamptz,
  ADD COLUMN IF NOT EXISTS term_end                 timestamptz,
  ADD COLUMN IF NOT EXISTS exhibit                  jsonb,
  ADD COLUMN IF NOT EXISTS exhibit_file_key         text,
  ADD COLUMN IF NOT EXISTS signed_exhibit_file_key  text,
  ADD COLUMN IF NOT EXISTS provider_exhibit_item_id text,
  ADD COLUMN IF NOT EXISTS commission_rate_percent  numeric(6,3);

-- ── agreement_amendments ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.agreement_amendments (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  agreement_id             uuid NOT NULL REFERENCES public.landlord_agreements(id) ON DELETE RESTRICT,
  version_id               uuid REFERENCES public.agreement_versions(id) ON DELETE RESTRICT,
  status                   text NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'signed', 'voided')),
  previous_exhibit         jsonb NOT NULL DEFAULT '[]'::jsonb,
  proposed_exhibit         jsonb NOT NULL DEFAULT '[]'::jsonb,
  exhibit_file_key         text,
  provider                 text NOT NULL DEFAULT 'documenso',
  provider_envelope_id     text,
  provider_exhibit_item_id text,
  signed_file_key          text,
  signed_exhibit_file_key  text,
  signer_name              text,
  signer_title             text,
  authorized_at            timestamptz,
  signed_at                timestamptz,
  ended_reason             text,
  ended_at                 timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'signed' OR signed_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_agreement_amendments_user
  ON public.agreement_amendments (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agreement_amendments_agreement
  ON public.agreement_amendments (agreement_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_agreement_amendments_pending
  ON public.agreement_amendments (user_id) WHERE status = 'sent';
CREATE UNIQUE INDEX IF NOT EXISTS uq_agreement_amendments_envelope
  ON public.agreement_amendments (provider_envelope_id) WHERE provider_envelope_id IS NOT NULL;

-- ── agreement_coverage ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.agreement_coverage (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  listing_id    uuid NOT NULL REFERENCES public.listings(id) ON DELETE RESTRICT,
  address       text NOT NULL,
  units         jsonb NOT NULL DEFAULT '[]'::jsonb,
  agreement_id  uuid NOT NULL REFERENCES public.landlord_agreements(id) ON DELETE RESTRICT,
  amendment_id  uuid REFERENCES public.agreement_amendments(id) ON DELETE RESTRICT,
  status        text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'covered', 'released')),
  covered_at    timestamptz,
  released_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'covered' OR covered_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_agreement_coverage_user
  ON public.agreement_coverage (user_id, status);
CREATE INDEX IF NOT EXISTS idx_agreement_coverage_listing
  ON public.agreement_coverage (listing_id);
-- A property appears once per master agreement (outside released rows).
CREATE UNIQUE INDEX IF NOT EXISTS uq_agreement_coverage_property
  ON public.agreement_coverage (agreement_id, listing_id) WHERE status <> 'released';

-- An unsigned document never covers a property.
CREATE OR REPLACE FUNCTION public.fn_agreement_coverage_requires_signature()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  doc_status text;
BEGIN
  IF NEW.status <> 'covered' THEN
    RETURN NEW;
  END IF;
  IF NEW.amendment_id IS NOT NULL THEN
    SELECT status INTO doc_status FROM public.agreement_amendments WHERE id = NEW.amendment_id;
  ELSE
    SELECT status INTO doc_status FROM public.landlord_agreements WHERE id = NEW.agreement_id;
  END IF;
  IF doc_status IS DISTINCT FROM 'signed' THEN
    RAISE EXCEPTION 'agreement_coverage: a property is covered only by a signed document (document is %)', coalesce(doc_status, 'missing')
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_agreement_coverage_requires_signature() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_agreement_coverage_requires_signature() TO service_role;

DROP TRIGGER IF EXISTS trg_agreement_coverage_requires_signature ON public.agreement_coverage;
CREATE TRIGGER trg_agreement_coverage_requires_signature
  BEFORE INSERT OR UPDATE ON public.agreement_coverage
  FOR EACH ROW EXECUTE FUNCTION public.fn_agreement_coverage_requires_signature();

-- ── Service role only, audit logged, like every billing table ──────────────
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['agreement_amendments', 'agreement_coverage'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', tbl);
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_set_updated_at_%1$s ON public.%1$I;
       CREATE TRIGGER trg_set_updated_at_%1$s BEFORE UPDATE ON public.%1$I
         FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();', tbl);
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_action_log_%1$s ON public.%1$I;
       CREATE TRIGGER trg_action_log_%1$s AFTER INSERT OR UPDATE OR DELETE ON public.%1$I
         FOR EACH ROW EXECUTE FUNCTION fn_action_log();', tbl);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
