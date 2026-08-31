-- Two properties must not share a display name.
--
-- listings.title is what a student reads on a browse card, and nothing has ever
-- constrained it. Production carries one collision today: seven MOSAIC rows at
-- seven different University City addresses, all the same landlord's portfolio
-- under one brand. Address-level identity already keeps those seven apart —
-- property_key is the real key, and the create flow attaches to an existing
-- property by address (see api/properties/lookup) — so the duplicate names were
-- never an identity bug. They are a legibility bug: browse ranks on photos and
-- rating, so the day a landlord's portfolio ranks well the feed shows the same
-- word several times over and a student cannot tell which building is which.
--
-- Scope is per SCHOOL, not global. Names collide meaningfully only inside the
-- market a student is shopping; "The Lofts" at WashU and "The Lofts" at another
-- campus are different buildings to different people, and nothing is served by
-- letting the first campus on the platform reserve a name everywhere. NULL
-- school_id is folded into one bucket rather than treated as distinct-per-row:
-- Postgres considers NULLs unequal in a unique index, so without the coalesce
-- the 21 unschooled rows — and every new listing, since api/addListing does not
-- set school_id yet — would be exempt from the rule entirely.
--
-- Blank names stay exempt. 62 of 141 listings have no title at all; a property
-- is allowed to go unnamed and fall back to its address, and forcing those into
-- the uniqueness bucket would collapse them all onto each other.

-- ---------------------------------------------------------------------------
-- 1. The normalizer, shared by the index and the application.
-- ---------------------------------------------------------------------------
-- Same reasoning as normalize_property_key: the app must not carry its own copy
-- of this rule, or a name the API accepts can still be rejected by the index.
-- lib/listings/propertyName.js calls this function rather than reimplementing it.
--
-- IMMUTABLE is what makes it indexable, and is honest here — lower/regexp_replace/
-- btrim depend on nothing outside their input.
create or replace function normalize_property_name(p_title text)
returns text
language sql
immutable
as $$
  select nullif(btrim(regexp_replace(lower(p_title), '\s+', ' ', 'g')), '');
$$;

comment on function normalize_property_name(text) is
  'Canonical form of listings.title for uniqueness: lowercased, whitespace collapsed, trimmed. Blank becomes NULL so unnamed properties never collide.';

-- ---------------------------------------------------------------------------
-- 2. Disambiguate the names that already collide.
-- ---------------------------------------------------------------------------
-- Data-driven rather than a hardcoded MOSAIC fix, so this is correct whatever
-- the dev snapshot happens to hold. Each colliding row keeps its brand and gains
-- its street line ("MOSAIC" -> "MOSAIC - 718 Limit Ave"), which is how a person
-- would tell the seven apart anyway. Rows whose address has no usable first
-- segment are left alone and will surface as an index failure below rather than
-- being renamed to a dangling separator.
update listings l
set title = l.title || ' - ' || nullif(btrim(split_part(l.address, ',', 1)), '')
where l.deleted_at is null
  and normalize_property_name(l.title) is not null
  and nullif(btrim(split_part(l.address, ',', 1)), '') is not null
  and exists (
    select 1
    from listings o
    where o.deleted_at is null
      and o.id <> l.id
      and normalize_property_name(o.title) = normalize_property_name(l.title)
      and coalesce(o.school_id, '00000000-0000-0000-0000-000000000000'::uuid)
        = coalesce(l.school_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

-- ---------------------------------------------------------------------------
-- 3. The guard itself.
-- ---------------------------------------------------------------------------
-- Partial so that unnamed and soft-deleted properties stay out of the way: a
-- deleted listing must never hold its name hostage against a live one.
--
-- This is the backstop, not the user-facing check. The API returns a readable
-- "This property name is taken" before it ever gets here (api/addListing and
-- api/landlord/listings/[listingId]); the index is what makes the rule true for
-- paths that do not go through those routes — the generic admin table editor,
-- the PMS sync, a future importer, a hand-written SQL fix.
create unique index if not exists listings_unique_property_name_per_school
  on listings (
    coalesce(school_id, '00000000-0000-0000-0000-000000000000'::uuid),
    normalize_property_name(title)
  )
  where deleted_at is null and normalize_property_name(title) is not null;

comment on index listings_unique_property_name_per_school is
  'One display name per school. Unnamed and soft-deleted properties are exempt; NULL school_id is a single shared bucket.';
