-- ===========================================================================
-- Retire listing_units.available
-- ===========================================================================
--
-- A unit's availability is no longer stored. It is derived from the offerings
-- on that unit (unit_leases): a unit is available when it carries at least one
-- live offering, or when it carries no offering at all (terms unknown is not
-- the same as gone — see apps/web/src/lib/listings/unitAvailability.js, which
-- is the one definition every read path now shares).
--
-- WHY: the flag was set on one screen, reported on another, and nothing kept
-- the two honest. 721 Limit Avenue sat invisible to students for three weeks
-- while its landlord's dashboard showed a green "Available", because the unit
-- form's checkbox had been unticked once at save time. Three listings were in
-- that state the day this was written; all three come back when this lands.
--
-- DEPLOY ORDER — three steps, in this order, and they are not interchangeable:
--
--   1. 202609020001_backfill_legacy_unit_leases.sql   BEFORE the deploy.
--      The new rule reads a unit with no live offering as off-market. Eight
--      live properties have no offering only because their leases were left in
--      the retired listing_leases table. Ship the code first and they go dark.
--   2. Deploy the application code.
--   3. THIS migration.
--
-- Step 3 must follow step 2 because PL/pgSQL bodies are not re-checked when a
-- column disappears: the old code would not fail at deploy, it would fail
-- per-request, on the first browse query that selects the column.
--
-- Applies to BOTH dev and prod (see .claude/rules/api.md).
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. rpc_pms_apply — p_unit_updates now moves OFFERINGS, not a unit column.
--
-- The parameter keeps its shape ({id, available}) so every existing caller
-- still works; what changes is where the write lands. Callers needing an
-- exactly reversible change (auto-unavailable's hide, and its Undo) may add
-- "lease_ids" to name the offerings they touched, so a relist restores that set
-- and never revives an offering some other landlord withdrew for their own
-- reasons.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_pms_apply(
  p_user_id uuid,
  p_listing_id uuid,
  p_listing_updates jsonb DEFAULT NULL::jsonb,
  p_unit_updates jsonb DEFAULT NULL::jsonb,
  p_lease_updates jsonb DEFAULT NULL::jsonb,
  p_owner_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
declare
  v_cols       text;
  v_sel        text;
  v_sql        text;
  v_item       jsonb;
  v_unit_id    uuid;
  v_rent       numeric;
  v_avail      date;
  v_want_avail boolean;
  v_lease_ids  uuid[];
  v_rows       integer;
  v_units_touched  int := 0;
  v_leases_touched int := 0;
begin
  perform set_config('app.current_user_id', p_user_id::text, true);

  if p_listing_updates is not null and p_listing_updates <> '{}'::jsonb then
    v_cols := (select string_agg(quote_ident(k), ', ') from jsonb_object_keys(p_listing_updates) k);
    v_sel  := (select string_agg('r.' || quote_ident(k), ', ') from jsonb_object_keys(p_listing_updates) k);
    v_sql  := format(
      'update listings t set (%s) = (select %s from jsonb_populate_record(null::listings, $1) r) where t.id = $2',
      v_cols, v_sel
    );
    execute v_sql using p_listing_updates, p_listing_id;
  end if;

  if p_unit_updates is not null then
    for v_item in select * from jsonb_array_elements(p_unit_updates) loop
      v_unit_id    := (v_item->>'id')::uuid;
      v_want_avail := (v_item->>'available')::boolean;
      if v_unit_id is null or v_want_avail is null then
        continue;
      end if;

      -- only touch units that belong to this listing
      if not exists (select 1 from listing_units where id = v_unit_id and listing_id = p_listing_id) then
        continue;
      end if;

      v_lease_ids := case
        when jsonb_typeof(v_item->'lease_ids') = 'array'
          then array(select jsonb_array_elements_text(v_item->'lease_ids')::uuid)
        else null
      end;

      update unit_leases
         set unavailable = not v_want_avail
       where unit_id = v_unit_id
         and is_active = true
         and coalesce(unavailable, false) <> (not v_want_avail)
         and (v_lease_ids is null or id = any(v_lease_ids))
         and (
           p_owner_id is null
           or owner_id = p_owner_id
           or owner_id is null
         );

      get diagnostics v_rows = row_count;
      if v_rows > 0 then v_units_touched := v_units_touched + 1; end if;
    end loop;
  end if;

  if p_lease_updates is not null then
    for v_item in select * from jsonb_array_elements(p_lease_updates) loop
      v_unit_id := (v_item->>'unit_id')::uuid;
      v_rent    := nullif(v_item->>'rent', '')::numeric;
      v_avail   := nullif(v_item->>'available_from', '')::date;

      -- only touch units that belong to this listing
      if not exists (select 1 from listing_units where id = v_unit_id and listing_id = p_listing_id) then
        continue;
      end if;

      update unit_leases
         set rent           = coalesce(v_rent, rent),
             available_from = coalesce(v_avail, available_from)
       where unit_id = v_unit_id
         and is_active = true
         and not coalesce(unavailable, false)
         and (
           p_owner_id is null
           or owner_id = p_owner_id
           or owner_id is null
         );

      if not found and (v_rent is not null or v_avail is not null) then
        insert into unit_leases (unit_id, owner_id, rent, is_active, available_from)
        values (v_unit_id, p_owner_id, v_rent, true, v_avail);
      end if;
      v_leases_touched := v_leases_touched + 1;
    end loop;
  end if;

  return jsonb_build_object('units', v_units_touched, 'leases', v_leases_touched);
end;
$function$;

-- ---------------------------------------------------------------------------
-- 2. rpc_create_listing / rpc_edit_listing — stop writing the column.
--
-- Each names `available` in a handful of places inside a long body of otherwise
-- unrelated logic. Re-vendoring those bodies into this file would duplicate
-- ~200 lines that go stale the moment either function changes again, and a
-- transcription slip would be invisible in review. So each fragment is removed
-- from the function's OWN current definition, and the rewrite RAISES if nothing
-- changed or if a reference survives — this migration cannot half-apply.
-- CREATE FUNCTION syntax-checks the rewritten body, so a mangled result fails
-- here, inside this transaction, rather than at request time.
-- ---------------------------------------------------------------------------
DO $rewrite$
DECLARE
  v_fn  text;
  v_src text;
  v_out text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY['rpc_create_listing', 'rpc_edit_listing'] LOOP
    SELECT pg_get_functiondef(p.oid) INTO v_src
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = v_fn;

    IF v_src IS NULL THEN
      RAISE EXCEPTION 'retire-unit-available: function public.% not found', v_fn;
    END IF;

    -- a) the column out of the INSERT column list
    v_out := regexp_replace(
      v_src,
      '(INSERT INTO listing_units \([^)]*), available,',
      '\1,', 'g');

    -- b) the matching VALUES entry (occupies its own line)
    v_out := regexp_replace(
      v_out,
      '\n[ ]*COALESCE\(\(NULLIF\(v_unit->>''available'', ''''\)\)::boolean, true\),',
      '', 'g');

    -- c) the UPDATE assignment (rpc_edit_listing only)
    v_out := regexp_replace(
      v_out,
      '\n[ ]*available[ ]*=[ ]*COALESCE\(\(NULLIF\(v_unit->>''available'', ''''\)\)::boolean, true\),',
      '', 'g');

    IF v_out = v_src THEN
      RAISE EXCEPTION 'retire-unit-available: % matched no fragment — its shape changed, rewrite by hand', v_fn;
    END IF;
    IF v_out ~ 'v_unit->>''available''' THEN
      RAISE EXCEPTION 'retire-unit-available: % still references the unit availability flag', v_fn;
    END IF;

    EXECUTE v_out;
    RAISE NOTICE 'retire-unit-available: rewrote %', v_fn;
  END LOOP;
END
$rewrite$;

-- ---------------------------------------------------------------------------
-- 3. Drop the column.
--
-- Everything that read it now derives the same answer from unit_leases, and
-- nothing writes it. Dropping it loses no information: for the 21 units it was
-- hiding against a live offering the derived answer is the correct one (those
-- come back), and for the 49 whose offerings are all withdrawn it already
-- agreed.
-- ---------------------------------------------------------------------------
ALTER TABLE public.listing_units DROP COLUMN IF EXISTS available;

COMMIT;
