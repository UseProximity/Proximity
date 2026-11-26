-- Commission agreements signed in the app through Documenso (In-App Payments).
--
-- ── agreement_versions ──────────────────────────────────────────────────────
-- The agreement document itself. An admin uploads each version as a PDF in the
-- admin dashboard; it is stored in R2 and pushed to Documenso as a template. The
-- admin places the signature boxes in Documenso's editor, checks them from our
-- dashboard, then makes the version live. Exactly one version is live at a time.
--
--   status            draft    uploaded, signature boxes not yet checked
--                     ready    boxes checked, can be made live
--                     live     the one landlords sign now
--                     retired  was live once; kept for the signatures made on it
--   requires_resign   chosen when the version is made live: if true, a signature
--                     on any earlier version no longer satisfies the listing gate
--   provider_*        Documenso's template id, the template's signer recipient id
--                     (needed to create each landlord's copy), and the id of an
--                     optional "Title" text box we fill in with the signer's title
--
-- ── landlord_agreements ─────────────────────────────────────────────────────
-- Each landlord's signing record now points at the version they signed and keeps
-- the signer's title and their "authorised to sign" confirmation. A landlord can
-- hold one signed record and, while re-signing a newer version, one in progress,
-- so the one-live-row index becomes one-pending plus one-signed. A signature
-- replaced by a newer one becomes 'superseded', so its PDF and history are kept.
-- ended_reason says why a record was voided (declined in Documenso, cancelled,
-- voided by an admin).
--
-- Idempotent. Apply to BOTH dev and prod (prod together with 202610310001).

CREATE TABLE IF NOT EXISTS public.agreement_versions (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label                    text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 80),
  file_key                 text NOT NULL,
  file_name                text,
  file_bytes               integer,
  status                   text NOT NULL DEFAULT 'draft'
                           CHECK (status IN ('draft', 'ready', 'live', 'retired')),
  requires_resign          boolean NOT NULL DEFAULT false,
  provider                 text NOT NULL DEFAULT 'documenso',
  provider_template_id     text UNIQUE,
  provider_recipient_id    integer,
  provider_title_field_id  integer,
  provider_editor_url      text,
  provider_error           text,
  fields_checked_at        timestamptz,
  published_at             timestamptz,
  published_by_id          uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_by_id            uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CHECK (status NOT IN ('live', 'retired') OR published_at IS NOT NULL)
);

-- One live version.
CREATE UNIQUE INDEX IF NOT EXISTS uq_agreement_versions_live
  ON public.agreement_versions ((true)) WHERE status = 'live';

ALTER TABLE public.landlord_agreements
  ADD COLUMN IF NOT EXISTS version_id     uuid REFERENCES public.agreement_versions(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS signer_title   text,
  ADD COLUMN IF NOT EXISTS authorized_at  timestamptz,
  ADD COLUMN IF NOT EXISTS ended_reason   text,
  ADD COLUMN IF NOT EXISTS ended_at       timestamptz;

-- Status gains 'superseded'.
DO $$
DECLARE
  con record;
BEGIN
  FOR con IN
    SELECT c.conname
      FROM pg_constraint c
     WHERE c.conrelid = 'public.landlord_agreements'::regclass
       AND c.contype = 'c'
       AND pg_get_constraintdef(c.oid) LIKE '%not_sent%'
  LOOP
    EXECUTE format('ALTER TABLE public.landlord_agreements DROP CONSTRAINT %I', con.conname);
  END LOOP;

  ALTER TABLE public.landlord_agreements
    ADD CONSTRAINT landlord_agreements_status_check
    CHECK (status IN ('not_sent', 'sent', 'signed', 'superseded', 'voided'));
END $$;

-- One record in progress and one current signature per landlord.
DROP INDEX IF EXISTS public.uq_landlord_agreements_live;
CREATE UNIQUE INDEX IF NOT EXISTS uq_landlord_agreements_pending
  ON public.landlord_agreements (user_id) WHERE status IN ('not_sent', 'sent');
CREATE UNIQUE INDEX IF NOT EXISTS uq_landlord_agreements_signed
  ON public.landlord_agreements (user_id) WHERE status = 'signed';
-- A Documenso document belongs to one record; the webhook finds the record by it.
CREATE UNIQUE INDEX IF NOT EXISTS uq_landlord_agreements_envelope
  ON public.landlord_agreements (provider_envelope_id) WHERE provider_envelope_id IS NOT NULL;

-- Service role only, like every billing table.
ALTER TABLE public.agreement_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agreement_versions FROM anon, authenticated;

DROP TRIGGER IF EXISTS trg_set_updated_at_agreement_versions ON public.agreement_versions;
CREATE TRIGGER trg_set_updated_at_agreement_versions
  BEFORE UPDATE ON public.agreement_versions
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

DROP TRIGGER IF EXISTS trg_action_log_agreement_versions ON public.agreement_versions;
CREATE TRIGGER trg_action_log_agreement_versions
  AFTER INSERT OR UPDATE OR DELETE ON public.agreement_versions
  FOR EACH ROW EXECUTE FUNCTION fn_action_log();

NOTIFY pgrst, 'reload schema';
