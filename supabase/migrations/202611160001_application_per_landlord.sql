-- Apply tracking, review fixes (Wyatt, 2026-11-16, PR 440 review).
--
-- ── One row per student per landlord ────────────────────────────────────────
--   Rows were unique per application link, so two co-landlords who paste the
--   same portal URL shared one row and the student moved between their lists
--   on every click. Now a row belongs to one landlord. A lease with no owner
--   (legacy) falls back to the link, as before.
--
-- ── record_application_click ────────────────────────────────────────────────
--   The Apply click in one statement: insert, or count the repeat. The old
--   read-then-write lost counts on concurrent clicks. A repeat click after
--   "I'm not applying" puts the row back to "started", so the student is asked
--   "Did you submit?" again; "applied" stays applied.
--
-- ── unit_leases application_url on new leases ───────────────────────────────
--   One link per landlord per property: a lease a landlord adds later (editor,
--   add flow, importer, PMS) takes the link from their other leases there, the
--   same block contact_email already follows.
--
-- Server-side only (service role). Idempotent. Apply to BOTH dev and prod.

ALTER TABLE public.listing_applications
  DROP CONSTRAINT IF EXISTS listing_applications_listing_id_student_id_application_url_key;

CREATE UNIQUE INDEX IF NOT EXISTS listing_applications_per_landlord
  ON public.listing_applications (listing_id, student_id, (COALESCE(landlord_id::text, application_url)));

CREATE OR REPLACE FUNCTION public.record_application_click(
  p_listing_id uuid,
  p_student_id uuid,
  p_landlord_id uuid,
  p_lease_id uuid,
  p_application_url text
) RETURNS SETOF public.listing_applications
LANGUAGE sql
SET search_path = public, pg_temp
AS $$
  INSERT INTO public.listing_applications AS a
    (listing_id, student_id, landlord_id, lease_id, application_url)
  VALUES (p_listing_id, p_student_id, p_landlord_id, p_lease_id, p_application_url)
  ON CONFLICT (listing_id, student_id, (COALESCE(landlord_id::text, application_url)))
  DO UPDATE SET
    click_count     = a.click_count + 1,
    last_clicked_at = now(),
    lease_id        = EXCLUDED.lease_id,
    application_url = EXCLUDED.application_url,
    status          = CASE WHEN a.status = 'not_applying' THEN 'started' ELSE a.status END,
    answered_at     = CASE WHEN a.status = 'not_applying' THEN NULL ELSE a.answered_at END,
    updated_at      = now()
  RETURNING a.*;
$$;

REVOKE ALL ON FUNCTION public.record_application_click(uuid, uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_application_click(uuid, uuid, uuid, uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.unit_leases_inherit_application_url()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  SELECT ul.application_url INTO NEW.application_url
  FROM public.unit_leases ul
  JOIN public.listing_units lu ON lu.id = ul.unit_id
  WHERE ul.owner_id = NEW.owner_id
    AND lu.listing_id = (SELECT listing_id FROM public.listing_units WHERE id = NEW.unit_id)
    AND ul.deleted_at IS NULL
    AND ul.application_url IS NOT NULL
  ORDER BY ul.updated_at DESC NULLS LAST
  LIMIT 1;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.unit_leases_inherit_application_url() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS unit_leases_inherit_application_url ON public.unit_leases;
CREATE TRIGGER unit_leases_inherit_application_url
  BEFORE INSERT ON public.unit_leases
  FOR EACH ROW
  WHEN (NEW.application_url IS NULL AND NEW.owner_id IS NOT NULL)
  EXECUTE FUNCTION public.unit_leases_inherit_application_url();
