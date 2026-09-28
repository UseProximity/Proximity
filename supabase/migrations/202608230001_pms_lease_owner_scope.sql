-- PMS sync must only rewrite the connection owner's OWN offerings.
--
-- rpc_pms_apply updated every active lease on a unit:
--
--     update unit_leases set rent = ..., available_from = ...
--      where unit_id = v_unit_id and is_active = true;
--
-- Under the old model that was correct — a unit carried exactly one lease. Now
-- that several landlords can each offer the same unit (unit_leases.owner_id),
-- the same statement silently rewrites a COMPETING landlord's price and
-- availability every time the first landlord's integration syncs. The other
-- landlord never touched their listing and has no way to see why it changed.
--
-- Scope is therefore the connection owner's leases, plus unclaimed ones
-- (owner_id is null — imported before the owner had an account, which is who the
-- integration is syncing for anyway). Withdrawn offerings are left alone: a
-- landlord who took an offering down should not have it repriced underneath them.

-- Adding p_owner_id changes the signature, so `create or replace` would produce
-- an OVERLOAD rather than a replacement — leaving the old unscoped function
-- callable and making any 5-argument call ambiguous. Drop it first.
drop function if exists public.rpc_pms_apply(uuid, uuid, jsonb, jsonb, jsonb);

create or replace function public.rpc_pms_apply(
  p_user_id uuid,
  p_listing_id uuid,
  p_listing_updates jsonb default null::jsonb,
  p_unit_updates jsonb default null::jsonb,
  p_lease_updates jsonb default null::jsonb,
  -- The landlord whose integration produced these updates (pms_connections.user_id).
  -- null keeps the pre-scoping behaviour, for callers that predate this argument.
  p_owner_id uuid default null
)
returns jsonb
language plpgsql
security definer
as $function$
declare
  v_cols    text;
  v_sel     text;
  v_sql     text;
  v_item    jsonb;
  v_unit_id uuid;
  v_rent    numeric;
  v_avail   date;
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
      update listing_units
         set available = (v_item->>'available')::boolean
       where id = (v_item->>'id')::uuid
         and listing_id = p_listing_id;
      if found then v_units_touched := v_units_touched + 1; end if;
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
