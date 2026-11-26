-- PMS sync: an offering the sync creates on its own starts as a draft.
--
-- rpc_pms_apply inserts a unit_leases row when a synced floor plan has no
-- offering to reprice. Since 202610100002 the landlord decides what students
-- see, so that row is born unpublished (published_at NULL) and waits under
-- Properties > Drafts like any other addition to a live building. Repricing
-- an existing offering is untouched: that offering is already up.
--
-- Rewritten in place from the live definition with the replacement asserted,
-- as in 202610100002. Idempotent. Apply to BOTH dev and prod, after
-- 202610100002.

DO $migration$
DECLARE
  v_def text;
BEGIN
  v_def := pg_get_functiondef('public.rpc_pms_apply'::regproc);
  IF v_def LIKE '%available_from, published_at)%' THEN
    RETURN; -- already applied
  END IF;
  v_def := replace(v_def,
    'insert into unit_leases (unit_id, owner_id, rent, is_active, available_from)
        values (v_unit_id, p_owner_id, v_rent, true, v_avail);',
    'insert into unit_leases (unit_id, owner_id, rent, is_active, available_from, published_at)
        values (v_unit_id, p_owner_id, v_rent, true, v_avail, null);');
  IF v_def NOT LIKE '%available_from, published_at)%' THEN
    RAISE EXCEPTION 'rpc_pms_apply: draft insert not applied';
  END IF;
  EXECUTE v_def;
END
$migration$;
