-- Photos become one gallery per property, tagged with the units they show.
--
-- Until now a photo belonged to at most one unit (listing_images.unit_id), and
-- the dashboard gave every unit its own photo row. A picture of a shared kitchen
-- could not say it was true of Apt 1W and Apt 2W at once, and a renter opening
-- the gallery saw only the building plus whichever unit tab was open.
--
-- Tags live in their own table so one photo can carry several units. The legacy
-- unit_id column is left in place and simply stops being read: nulling it here
-- would change what the currently deployed site shows before the code that
-- reads tags is live. It goes in the dead-columns cleanup.

create table if not exists public.listing_image_units (
  image_id   uuid not null references public.listing_images(id) on delete cascade,
  unit_id    uuid not null references public.listing_units(id)  on delete cascade,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (image_id, unit_id)
);

create index if not exists listing_image_units_unit_id_idx
  on public.listing_image_units (unit_id);

-- A tag may only point at a unit of the photo's own property. The API checks
-- this too; the trigger is the backstop, same as listing_images_unit_matches_listing.
create or replace function public.trg_listing_image_units_same_listing()
returns trigger
language plpgsql
as $$
declare
  v_image_listing uuid;
  v_unit_listing  uuid;
begin
  select listing_id into v_image_listing from listing_images where id = new.image_id;
  select listing_id into v_unit_listing  from listing_units  where id = new.unit_id;

  if v_image_listing is null or v_unit_listing is null or v_image_listing <> v_unit_listing then
    raise exception
      'Photo property (%) does not match the unit''s property (%)', v_image_listing, v_unit_listing
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists listing_image_units_same_listing on public.listing_image_units;
create trigger listing_image_units_same_listing
  before insert or update on public.listing_image_units
  for each row execute function public.trg_listing_image_units_same_listing();

drop trigger if exists trg_action_log_listing_image_units on public.listing_image_units;
create trigger trg_action_log_listing_image_units
  after insert or delete or update on public.listing_image_units
  for each row execute function public.fn_action_log();

alter table public.listing_image_units enable row level security;

drop policy if exists listing_image_units_select on public.listing_image_units;
create policy listing_image_units_select on public.listing_image_units
  for select using (true);

drop policy if exists listing_image_units_write on public.listing_image_units;
create policy listing_image_units_write on public.listing_image_units
  for all using (
    fn_current_user_role() = 'super'
    or exists (
      select 1 from listing_images i
      join listing_landlords ll on ll.listing_id = i.listing_id
      where i.id = listing_image_units.image_id
        and ll.user_id = fn_current_user_id()
    )
  );

-- Every existing unit photo keeps its unit, now as a tag. Some uploaders'
-- accounts no longer exist, so created_by is only carried over when it resolves.
insert into public.listing_image_units (image_id, unit_id, created_by, created_at)
select i.id, i.unit_id, u.id, coalesce(i.created_at, now())
from public.listing_images i
left join public.users u on u.id = i.owner_id
where i.unit_id is not null
on conflict do nothing;

-- One sequence per property. sort_order used to restart for the property and
-- for each unit, so merging them would collide. Property photos keep the front
-- (the first is the cover), then each unit's photos follow in their own order.
-- Relative order inside every old scope is preserved, so the deployed site,
-- which still sorts within scopes, is unaffected.
with ranked as (
  select id,
         row_number() over (
           partition by listing_id
           order by (unit_id is not null), unit_id, sort_order, created_at, id
         ) - 1 as new_order
  from public.listing_images
)
update public.listing_images li
set sort_order = r.new_order
from ranked r
where li.id = r.id
  and li.sort_order is distinct from r.new_order;

-- Deleting a lease. "Withdraw" stays the reversible act (is_active / unavailable);
-- delete takes the offering off the landlord's dashboard for good. The row is
-- kept so enquiries and photo attribution that point at it are not orphaned.
alter table public.unit_leases
  add column if not exists deleted_at timestamptz;
