-- Landlords asking for changes to the commission agreement (In-App Payments,
-- decisions of 2026-11-04). Documenso has no redlining, so it happens here.
--
-- ── agreement_change_requests ───────────────────────────────────────────────
-- One per request, about the master agreement or an Exhibit A amendment, before
-- or after signing. One active request per landlord; follow-ups are messages.
--
--   open      waiting on the team
--   answered  the team replied; waiting on the landlord
--   accepted  the team agreed and is preparing (or has made live) a version for
--             this landlord only (agreement_versions.landlord_id)
--   resolved  the landlord signed the negotiated version
--   declined  the team said no; the landlord can sign the standard agreement
--   withdrawn the landlord closed it
--
-- ── agreement_change_messages ───────────────────────────────────────────────
-- The thread: the landlord's request is the first message. A message may carry
-- one file (their marked-up PDF or Word document), stored privately in R2 and
-- never sent to Documenso.
--
-- Idempotent. Apply to BOTH dev and prod (after 202611050001).

CREATE TABLE IF NOT EXISTS public.agreement_change_requests (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  document_kind          text NOT NULL DEFAULT 'master' CHECK (document_kind IN ('master', 'amendment')),
  agreement_id           uuid REFERENCES public.landlord_agreements(id) ON DELETE RESTRICT,
  amendment_id           uuid REFERENCES public.agreement_amendments(id) ON DELETE RESTRICT,
  version_id             uuid REFERENCES public.agreement_versions(id) ON DELETE RESTRICT,
  section                text CHECK (section IS NULL OR char_length(section) <= 200),
  status                 text NOT NULL DEFAULT 'open'
                         CHECK (status IN ('open', 'answered', 'accepted', 'resolved', 'declined', 'withdrawn')),
  resolution_version_id  uuid REFERENCES public.agreement_versions(id) ON DELETE RESTRICT,
  closed_at              timestamptz,
  closed_by_id           uuid REFERENCES public.users(id) ON DELETE SET NULL,
  last_team_alert_at     timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_agreement_change_requests_active
  ON public.agreement_change_requests (user_id) WHERE status IN ('open', 'answered', 'accepted');
CREATE INDEX IF NOT EXISTS idx_agreement_change_requests_status
  ON public.agreement_change_requests (status, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.agreement_change_messages (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id   uuid NOT NULL REFERENCES public.agreement_change_requests(id) ON DELETE RESTRICT,
  author_id    uuid REFERENCES public.users(id) ON DELETE SET NULL,
  author_role  text NOT NULL CHECK (author_role IN ('landlord', 'admin')),
  body         text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 10000),
  proposed_text text CHECK (proposed_text IS NULL OR char_length(proposed_text) <= 10000),
  file_key     text,
  file_name    text,
  file_type    text,
  file_bytes   integer,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agreement_change_messages_request
  ON public.agreement_change_messages (request_id, created_at);

-- A negotiated version points at the request it answers.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agreement_versions_change_request_fkey') THEN
    ALTER TABLE public.agreement_versions
      ADD CONSTRAINT agreement_versions_change_request_fkey
      FOREIGN KEY (change_request_id) REFERENCES public.agreement_change_requests(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['agreement_change_requests', 'agreement_change_messages'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', tbl);
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_action_log_%1$s ON public.%1$I;
       CREATE TRIGGER trg_action_log_%1$s AFTER INSERT OR UPDATE OR DELETE ON public.%1$I
         FOR EACH ROW EXECUTE FUNCTION fn_action_log();', tbl);
  END LOOP;
END $$;

DROP TRIGGER IF EXISTS trg_set_updated_at_agreement_change_requests ON public.agreement_change_requests;
CREATE TRIGGER trg_set_updated_at_agreement_change_requests
  BEFORE UPDATE ON public.agreement_change_requests
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

NOTIFY pgrst, 'reload schema';
