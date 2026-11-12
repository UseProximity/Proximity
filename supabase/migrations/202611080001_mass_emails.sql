-- Mass email from the admin dashboard (Wyatt, 2026-11-07).
--
-- An admin writes an email once as a template, saves each wording as a version
-- that never changes afterwards, picks who it goes to and sends it. Every email
-- goes out from info@useproximity.org with replies to info@useproximity.org.
--
-- ── mass_email_templates ────────────────────────────────────────────────────
-- A named email, for example "Billing and Proxy launch".
--
-- ── mass_email_versions ─────────────────────────────────────────────────────
-- One saved wording of a template. Never edited: a change is a new version, so
-- the record of what each person received stays true.
--   button_target  where the main button goes: billing | dashboard | custom | none
--   attachments    [{ "kind": "mrec" }] or [{ "kind": "file", "key", "fileName", "size" }]
--
-- ── mass_email_batches ──────────────────────────────────────────────────────
-- One press of Send: which version, who pressed it, and whether it also
-- switched Proxy on for the recipients' listings.
--
-- ── mass_email_recipients ───────────────────────────────────────────────────
-- One row per person per batch. provider_message_id joins to
-- sent_emails.provider_message_id for the delivery report from Amazon SES.
--
-- Server-side only (service role). Idempotent. Apply to BOTH dev and prod.

CREATE TABLE IF NOT EXISTS public.mass_email_templates (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  created_by   uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  archived_at  timestamptz
);

CREATE TABLE IF NOT EXISTS public.mass_email_versions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id    uuid NOT NULL REFERENCES public.mass_email_templates(id) ON DELETE CASCADE,
  version        integer NOT NULL CHECK (version > 0),
  subject        text NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 200),
  body           text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 20000),
  button_label   text CHECK (button_label IS NULL OR char_length(button_label) <= 60),
  button_target  text NOT NULL DEFAULT 'none' CHECK (button_target IN ('billing', 'dashboard', 'custom', 'none')),
  button_url     text CHECK (button_url IS NULL OR char_length(button_url) <= 1000),
  attachments    jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(attachments) = 'array'),
  footer_reason  text NOT NULL CHECK (char_length(footer_reason) BETWEEN 1 AND 300),
  commercial     boolean NOT NULL DEFAULT false,
  created_by     uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (template_id, version)
);

CREATE TABLE IF NOT EXISTS public.mass_email_batches (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id       uuid NOT NULL REFERENCES public.mass_email_versions(id) ON DELETE RESTRICT,
  created_by       uuid REFERENCES public.users(id) ON DELETE SET NULL,
  turn_proxy_on    boolean NOT NULL DEFAULT false,
  recipient_count  integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.mass_email_recipients (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id             uuid NOT NULL REFERENCES public.mass_email_batches(id) ON DELETE CASCADE,
  version_id           uuid NOT NULL REFERENCES public.mass_email_versions(id) ON DELETE RESTRICT,
  template_id          uuid NOT NULL REFERENCES public.mass_email_templates(id) ON DELETE CASCADE,
  user_id              uuid REFERENCES public.users(id) ON DELETE SET NULL,
  email                text NOT NULL,
  -- sent: handed to the mailer. redirected: off production, went to the test inbox.
  -- suppressed: off production with no test inbox. failed: the mailer refused it.
  status               text NOT NULL CHECK (status IN ('sent', 'redirected', 'suppressed', 'failed')),
  status_detail        text,
  provider_message_id  text,
  -- The button was a set-password link (the account had no way to sign in).
  setup_link           boolean NOT NULL DEFAULT false,
  -- How many of their listings this batch switched Proxy on for.
  proxy_listings       integer NOT NULL DEFAULT 0,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mass_email_versions_template_idx ON public.mass_email_versions (template_id, version DESC);
CREATE INDEX IF NOT EXISTS mass_email_batches_version_idx ON public.mass_email_batches (version_id, created_at DESC);
CREATE INDEX IF NOT EXISTS mass_email_recipients_template_user_idx ON public.mass_email_recipients (template_id, user_id);
CREATE INDEX IF NOT EXISTS mass_email_recipients_batch_idx ON public.mass_email_recipients (batch_id);
CREATE INDEX IF NOT EXISTS mass_email_recipients_message_idx ON public.mass_email_recipients (provider_message_id) WHERE provider_message_id IS NOT NULL;

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['mass_email_templates', 'mass_email_versions', 'mass_email_batches', 'mass_email_recipients'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', tbl);
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_action_log_%1$s ON public.%1$I;
       CREATE TRIGGER trg_action_log_%1$s AFTER INSERT OR UPDATE OR DELETE ON public.%1$I
         FOR EACH ROW EXECUTE FUNCTION fn_action_log();', tbl);
  END LOOP;
END $$;

DROP TRIGGER IF EXISTS trg_set_updated_at_mass_email_templates ON public.mass_email_templates;
CREATE TRIGGER trg_set_updated_at_mass_email_templates
  BEFORE UPDATE ON public.mass_email_templates
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- ── sent_emails: a "mass" category ──────────────────────────────────────────
-- Mass emails are logged like every other email (lib/emailLog.js) under their
-- own tab on the admin Sent emails page. Without this the log insert is refused
-- and the email goes unrecorded.
DO $$
DECLARE
  con record;
BEGIN
  FOR con IN
    SELECT c.conname
      FROM pg_constraint c
     WHERE c.conrelid = 'public.sent_emails'::regclass
       AND c.contype = 'c'
       AND pg_get_constraintdef(c.oid) LIKE '%category%'
  LOOP
    EXECUTE format('ALTER TABLE public.sent_emails DROP CONSTRAINT %I', con.conname);
  END LOOP;

  ALTER TABLE public.sent_emails
    ADD CONSTRAINT sent_emails_category_check
    CHECK (category IN ('chat', 'account', 'reviews', 'landlords', 'billing', 'mass', 'team', 'other'));
END $$;
