-- One contact per landlord per property (data only, no schema change).
--
-- unit_leases.contact_* stay the storage, but a landlord with an account now
-- sets them once per property (PUT /api/landlord/listings/[listingId]/contact)
-- and every lease they own there carries the same block. Browse groups a
-- unit's leases by contact email, so a landlord whose leases disagreed would
-- show up as two landlords. This brings existing rows in line:
--
--   for each (owner, property), the email used on most of their leases wins
--   (ties: the most recently edited). Name and phone are each the value used
--   most among the leases carrying that email, ignoring blanks, so a name that
--   was filled in once is kept rather than wiped by a lease that never had one.
--   Every lease they own at that property is set to that block, including ones
--   with no contact at all.
--
-- Unclaimed leases (owner_id NULL, imported) are untouched: they have no
-- landlord to be consistent with and are reached only through these columns.
--
-- Applied: dev 2026-10-12 (8 rows), prod 2026-10-12 (10 rows).

with mine as (
  select l.id, l.owner_id, u.listing_id,
         lower(l.contact_email) as email, l.contact_email as email_raw,
         nullif(btrim(l.contact_name), '')  as contact_name,
         nullif(btrim(l.contact_phone), '') as contact_phone,
         l.updated_at
  from unit_leases l
  join listing_units u on u.id = l.unit_id
  where l.owner_id is not null
    and l.deleted_at is null
    and nullif(btrim(l.contact_email), '') is not null
),
ranked as (
  select owner_id, listing_id, email, count(*) as n, max(updated_at) as last_used
  from mine
  group by owner_id, listing_id, email
),
chosen as (
  select distinct on (owner_id, listing_id) owner_id, listing_id, email
  from ranked
  order by owner_id, listing_id, n desc, last_used desc
),
-- Leases carrying the winning email, which is where name and phone come from.
pool as (
  select m.*
  from mine m
  join chosen c on c.owner_id = m.owner_id and c.listing_id = m.listing_id and c.email = m.email
),
email_raw as (
  select distinct on (owner_id, listing_id) owner_id, listing_id, email_raw
  from pool order by owner_id, listing_id, updated_at desc
),
name_pick as (
  select distinct on (owner_id, listing_id) owner_id, listing_id, contact_name
  from (
    select owner_id, listing_id, contact_name, count(*) as n, max(updated_at) as last_used
    from pool where contact_name is not null
    group by owner_id, listing_id, contact_name
  ) x
  order by owner_id, listing_id, n desc, last_used desc
),
phone_pick as (
  select distinct on (owner_id, listing_id) owner_id, listing_id, contact_phone
  from (
    select owner_id, listing_id, contact_phone, count(*) as n, max(updated_at) as last_used
    from pool where contact_phone is not null
    group by owner_id, listing_id, contact_phone
  ) x
  order by owner_id, listing_id, n desc, last_used desc
),
block as (
  select e.owner_id, e.listing_id, e.email_raw, np.contact_name, pp.contact_phone
  from email_raw e
  left join name_pick  np on np.owner_id = e.owner_id and np.listing_id = e.listing_id
  left join phone_pick pp on pp.owner_id = e.owner_id and pp.listing_id = e.listing_id
)
update unit_leases l
set contact_email = b.email_raw,
    contact_name  = b.contact_name,
    contact_phone = b.contact_phone
from listing_units u
join block b on b.listing_id = u.listing_id
where u.id = l.unit_id
  and l.owner_id = b.owner_id
  and l.deleted_at is null
  and (l.contact_email is distinct from b.email_raw
    or l.contact_name  is distinct from b.contact_name
    or l.contact_phone is distinct from b.contact_phone);
