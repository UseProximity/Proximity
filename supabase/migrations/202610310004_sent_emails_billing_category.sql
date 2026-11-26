-- Let billing emails (charge contested, invoice failed, overdue notice, ...) log
-- under their own category on the admin Sent emails page, instead of sharing
-- 'landlords'. Adds 'billing' to the sent_emails.category CHECK.
--
-- The original constraint was declared inline in 202610260001, so its name was
-- generated. Drop whichever CHECK mentions category rather than guess the name.
--
-- Idempotent. Apply to BOTH dev and prod.

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
    CHECK (category IN ('chat', 'account', 'reviews', 'landlords', 'billing', 'team', 'other'));
END $$;
