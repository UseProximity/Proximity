/*
 * A custom agreement version applies to a chosen set of landlords, not just one
 * (Wyatt, 2026-11-22). The admin picks them at upload and can add or remove them
 * at any time after.
 *
 * ── agreement_versions.audience ─────────────────────────────────────────────
 *   everyone   the standard version (one live per kind)
 *   selected   a custom version: it applies to the landlords listed in
 *              agreement_version_landlords. Fixed once uploaded.
 *
 * ── agreement_version_landlords ─────────────────────────────────────────────
 * One row each time a landlord is put on a custom version.
 *   kind        copied from the version, for the unique index below
 *   live        true while the version is live and the landlord is on it: the
 *               version they sign now. At most one per landlord per kind.
 *   removed_at  set when the admin takes them off (or another custom version
 *               replaces it for them). The row is kept as the record.
 *
 * agreement_versions.landlord_id (one landlord per version) is no longer written
 * by the app. It is kept, with a trigger that mirrors it into the new table, so
 * code still reading and writing it keeps working until every environment runs
 * the new code. A later migration can drop it.
 *
 * agreement_version_set_landlords() makes each change in one transaction (adding
 * and removing landlords, Make live, and moving landlords off their other custom
 * version), so a failure part way leaves nothing half done.
 *
 * RLS on with no policies: service role only, like agreement_versions. No
 * SECURITY DEFINER functions: every function here runs with the caller's rights,
 * and none is callable by anon or authenticated.
 *
 * Idempotent and additive. Apply to dev, verify, then prod.
 */

ALTER TABLE public.agreement_versions
  ADD COLUMN IF NOT EXISTS audience text NOT NULL DEFAULT 'everyone';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agreement_versions_audience_check') THEN
    ALTER TABLE public.agreement_versions
      ADD CONSTRAINT agreement_versions_audience_check CHECK (audience IN ('everyone', 'selected'));
  END IF;
END $$;

UPDATE public.agreement_versions SET audience = 'selected' WHERE landlord_id IS NOT NULL AND audience <> 'selected';

-- One live standard version per kind. A custom version (audience 'selected')
-- no longer needs landlord_id, so the standard index keys on audience.
DROP INDEX IF EXISTS public.uq_agreement_versions_live_standard;
CREATE UNIQUE INDEX IF NOT EXISTS uq_agreement_versions_live_standard
  ON public.agreement_versions (kind) WHERE status = 'live' AND audience = 'everyone';

-- One live custom version per landlord is now enforced on the assignment table
-- (uq_agreement_version_landlords_live below). The old per-version index would
-- refuse a carried-over one-landlord draft going live while that landlord's
-- previous version, shared with others since, stays live. No data changes.
DROP INDEX IF EXISTS public.uq_agreement_versions_live_landlord;

CREATE TABLE IF NOT EXISTS public.agreement_version_landlords (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id     uuid NOT NULL REFERENCES public.agreement_versions(id) ON DELETE CASCADE,
  landlord_id    uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  kind           text NOT NULL CHECK (kind IN ('master', 'amendment')),
  live           boolean NOT NULL DEFAULT false,
  added_by_id    uuid REFERENCES public.users(id) ON DELETE SET NULL,
  added_at       timestamptz NOT NULL DEFAULT now(),
  removed_by_id  uuid REFERENCES public.users(id) ON DELETE SET NULL,
  removed_at     timestamptz,
  CONSTRAINT agreement_version_landlords_removed_not_live CHECK (removed_at IS NULL OR NOT live)
);

ALTER TABLE public.agreement_version_landlords ENABLE ROW LEVEL SECURITY;

-- A landlord is on a version once at a time.
CREATE UNIQUE INDEX IF NOT EXISTS uq_agreement_version_landlords_active
  ON public.agreement_version_landlords (version_id, landlord_id) WHERE removed_at IS NULL;
-- At most one live custom version per landlord per kind.
CREATE UNIQUE INDEX IF NOT EXISTS uq_agreement_version_landlords_live
  ON public.agreement_version_landlords (kind, landlord_id) WHERE live;
CREATE INDEX IF NOT EXISTS idx_agreement_version_landlords_landlord
  ON public.agreement_version_landlords (landlord_id);

-- The existing one-landlord versions, carried over.
INSERT INTO public.agreement_version_landlords (version_id, landlord_id, kind, live, added_by_id, added_at, removed_at)
SELECT v.id, v.landlord_id, v.kind, v.status = 'live', v.created_by_id, v.created_at,
       -- When it was replaced: its last change, the retiring (published_at is when it went live).
       CASE WHEN v.status = 'retired' THEN coalesce(v.updated_at, v.published_at, v.created_at) END
FROM public.agreement_versions v
WHERE v.landlord_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.agreement_version_landlords l WHERE l.version_id = v.id AND l.landlord_id = v.landlord_id);

-- ── Compatibility with code that still writes landlord_id ──────────────────
-- A version written with landlord_id is a custom version for that landlord.
CREATE OR REPLACE FUNCTION public.agreement_versions_legacy_audience()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.landlord_id IS NOT NULL THEN
    NEW.audience := 'selected';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_agreement_versions_legacy_audience ON public.agreement_versions;
CREATE TRIGGER trg_agreement_versions_legacy_audience
  BEFORE INSERT OR UPDATE OF landlord_id ON public.agreement_versions
  FOR EACH ROW EXECUTE FUNCTION public.agreement_versions_legacy_audience();

-- ...and its landlord is on it, live while the version is live. Old code retires
-- the landlord's previous version before making the new one live, so the live
-- index holds in that order.
CREATE OR REPLACE FUNCTION public.agreement_versions_legacy_landlord()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.landlord_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.agreement_version_landlords WHERE version_id = NEW.id AND landlord_id = NEW.landlord_id) THEN
    INSERT INTO public.agreement_version_landlords (version_id, landlord_id, kind, live, added_by_id)
    VALUES (NEW.id, NEW.landlord_id, NEW.kind, NEW.status = 'live', NEW.created_by_id);
  ELSIF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    UPDATE public.agreement_version_landlords
       SET live = (NEW.status = 'live'),
           removed_at = CASE WHEN NEW.status = 'retired' THEN coalesce(removed_at, now()) ELSE removed_at END
     WHERE version_id = NEW.id AND landlord_id = NEW.landlord_id
       AND (removed_at IS NULL OR NEW.status = 'retired');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_agreement_versions_legacy_landlord ON public.agreement_versions;
CREATE TRIGGER trg_agreement_versions_legacy_landlord
  AFTER INSERT OR UPDATE OF status, landlord_id ON public.agreement_versions
  FOR EACH ROW EXECUTE FUNCTION public.agreement_versions_legacy_landlord();

-- Trigger functions are not callable as RPCs, but keep them off the API anyway.
REVOKE ALL ON FUNCTION public.agreement_versions_legacy_audience() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agreement_versions_legacy_landlord() FROM PUBLIC, anon, authenticated;

-- ── Changing who a custom version applies to, in one transaction ───────────
-- Adds p_add and takes off p_remove. When the version is live (or p_publish
-- makes it live, from ready), every landlord on it is moved onto it: taken off
-- their other live custom version of the same kind first, and a version left
-- with nobody that way is retired. Returns { changed: landlords whose version to
-- sign changed now, left: versions they left }. Raises not_found, not_custom,
-- retired or not_ready; a concurrent change surfaces as a unique violation.
CREATE OR REPLACE FUNCTION public.agreement_version_set_landlords(
  p_version_id uuid,
  p_add uuid[],
  p_remove uuid[],
  p_admin_id uuid,
  p_publish boolean DEFAULT false,
  p_now timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v public.agreement_versions%ROWTYPE;
  v_removed uuid[] := '{}';
  v_moving uuid[] := '{}';
  v_left uuid[] := '{}';
BEGIN
  SELECT * INTO v FROM public.agreement_versions WHERE id = p_version_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF v.audience <> 'selected' THEN RAISE EXCEPTION 'not_custom'; END IF;
  IF v.status = 'retired' THEN RAISE EXCEPTION 'retired'; END IF;
  IF p_publish AND v.status <> 'ready' THEN RAISE EXCEPTION 'not_ready'; END IF;

  WITH r AS (
    UPDATE public.agreement_version_landlords
       SET live = false, removed_at = p_now, removed_by_id = p_admin_id
     WHERE version_id = v.id AND removed_at IS NULL
       AND landlord_id = ANY (coalesce(p_remove, '{}'))
       AND NOT (landlord_id = ANY (coalesce(p_add, '{}')))
    RETURNING landlord_id
  )
  SELECT coalesce(array_agg(landlord_id), '{}') INTO v_removed FROM r;

  INSERT INTO public.agreement_version_landlords (version_id, landlord_id, kind, live, added_by_id, added_at)
  SELECT v.id, a.id, v.kind, false, p_admin_id, p_now
    FROM (SELECT DISTINCT unnest(coalesce(p_add, '{}')) AS id) a
   WHERE a.id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.agreement_version_landlords l
                      WHERE l.version_id = v.id AND l.landlord_id = a.id AND l.removed_at IS NULL);

  IF v.status <> 'live' AND NOT p_publish THEN
    RETURN jsonb_build_object('changed', '[]'::jsonb, 'left', '[]'::jsonb);
  END IF;

  SELECT coalesce(array_agg(landlord_id), '{}') INTO v_moving
    FROM public.agreement_version_landlords
   WHERE version_id = v.id AND removed_at IS NULL AND NOT live;

  WITH o AS (
    UPDATE public.agreement_version_landlords
       SET live = false, removed_at = p_now, removed_by_id = p_admin_id
     WHERE kind = v.kind AND live AND version_id <> v.id AND landlord_id = ANY (v_moving)
    RETURNING version_id
  )
  SELECT coalesce(array_agg(DISTINCT version_id), '{}') INTO v_left FROM o;

  UPDATE public.agreement_versions av
     SET status = 'retired'
   WHERE av.id = ANY (v_left) AND av.status = 'live'
     AND NOT EXISTS (SELECT 1 FROM public.agreement_version_landlords l WHERE l.version_id = av.id AND l.removed_at IS NULL);

  IF p_publish THEN
    UPDATE public.agreement_versions
       SET status = 'live', requires_resign = false, published_at = p_now, published_by_id = p_admin_id
     WHERE id = v.id;
  END IF;

  UPDATE public.agreement_version_landlords SET live = true
   WHERE version_id = v.id AND removed_at IS NULL AND NOT live;

  RETURN jsonb_build_object('changed', to_jsonb(v_moving || v_removed), 'left', to_jsonb(v_left));
END;
$$;

REVOKE ALL ON FUNCTION public.agreement_version_set_landlords(uuid, uuid[], uuid[], uuid, boolean, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agreement_version_set_landlords(uuid, uuid[], uuid[], uuid, boolean, timestamptz) TO service_role;
