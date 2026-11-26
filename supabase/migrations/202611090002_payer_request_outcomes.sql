-- What happened to each listing a landlord sent their authorized signer
-- (Project B review fixes, Wyatt 2026-11-09).
--
-- Signing no longer publishes anything. The signer approves a listing and the
-- landlord publishes it when they choose. Each request now ends one of two ways
-- besides being cancelled:
--   approved  the signer signed it onto their agreement: the landlord can publish it
--   declined  it was on the document the signer signed (or rejected), and they
--             left it off: the landlord sees "Declined" and can send it again
-- 'published' stays allowed for rows written before this change.
--
-- document_kind / document_id: the document the request was put on when the
-- signer opened it. What is on a document is locked in: a listing sent later
-- waits for the next one, and only listings on the signed document are approved
-- or declined by it. Cleared when that document is cancelled or replaced
-- unsigned, so the listing goes on the next one.
--
-- Server-side only (service role). Idempotent. Apply to BOTH dev and prod.

ALTER TABLE public.payer_publish_requests DROP CONSTRAINT IF EXISTS payer_publish_requests_status_check;
ALTER TABLE public.payer_publish_requests
  ADD CONSTRAINT payer_publish_requests_status_check
  CHECK (status IN ('waiting', 'approved', 'declined', 'published', 'cancelled'));

ALTER TABLE public.payer_publish_requests ADD COLUMN IF NOT EXISTS document_kind text;
ALTER TABLE public.payer_publish_requests ADD COLUMN IF NOT EXISTS document_id uuid;

ALTER TABLE public.payer_publish_requests DROP CONSTRAINT IF EXISTS payer_publish_requests_document_check;
ALTER TABLE public.payer_publish_requests
  ADD CONSTRAINT payer_publish_requests_document_check
  CHECK ((document_kind IS NULL AND document_id IS NULL) OR (document_kind IN ('master', 'amendment') AND document_id IS NOT NULL));

CREATE INDEX IF NOT EXISTS idx_payer_publish_requests_document
  ON public.payer_publish_requests (document_id) WHERE document_id IS NOT NULL;
