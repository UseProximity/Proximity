# Proximity v2 DB Migration + Admin Dashboard Refactor

> Created: 2026-04-13 | Branch: staging | Status: Ready to implement

## Context

The current schema stores multi-value data in Postgres arrays (`landlord_id`, `amenities text[]`, `utilities_included text[]`, `images text[]`) with no FK constraints, lease terms scattered across `listings` and `listing_units`, and no audit trail. This migration normalizes everything into proper relational tables, adds per-unit contracts, connects users/listings to a `schools` table (WashU only for now), adds a full append-only action log, and refactors the admin dashboard from all-inline-editing to a click-to-open row detail modal.

---

## Critical Files

| File | Purpose |
|---|---|
| `scripts/v2-migration.sql` | **New** — full migration SQL (to be created) |
| `app/api/admin/[table]/route.js` | Add action logging, handle new tables |
| `app/dashboard/admin/page.js` | Major UI refactor (~2300 lines) |
| `scripts/supabase-schema.sql` | Reference — current schema |
| `libs/supabase.js` | Supabase client factory (dev/prod dual env) |

### ⚠️ Pre-flight Check
`landlord_id` is declared as scalar `uuid` in `supabase-schema.sql` but app code uses `.contains("landlord_id", [userId])` (array syntax). **Verify the actual live column type via `\d listings` in the Supabase SQL editor before running migration.** The data migration script handles both cases but needs adjustment if it's actually `uuid[]`.

---

## Current Schema Summary (as of migration start)

**Tables:** `users`, `listings`, `listing_units`, `reviews`, `dorms`, `dorm_reviews`, `testimonials`, `user_favorites`, `user_contacted`, `matchmaking_responses`

**Columns being migrated away from:**
- `listings.landlord_id` (uuid or uuid[]) → `listing_landlords` junction + `listings.primary_landlord_id`
- `listings.amenities text[]` → `amenities` lookup + `listing_amenities` junction
- `listings.utilities_included text[]` → `listing_utilities` boolean table
- `listings.images text[]` → `listing_media` (array kept for backward compat)
- `listings.lease_structure`, `listings.move_in_date`, `listings.sublease_friendly` → `contracts`
- `listing_units.lease_availability`, `listing_units.rent` → `contracts`

**Existing triggers to know about:**
- `trg_sync_listing_aggregates` — recomputes `min/max rent/beds/baths/area` on `listings` from `listing_units`. Will be updated to also read from `contracts`.
- `trg_*_updated_at` — auto-updates `updated_at` on all tables.

---

## New Tables Being Added

| Table | Purpose |
|---|---|
| `schools` | University lookup (WashU seeded) |
| `listing_landlords` | Junction: listing ↔ landlord (FK-safe, replaces array) |
| `amenities` | Amenity name lookup |
| `listing_amenities` | Junction: listing ↔ amenity |
| `listing_utilities` | One row per listing, boolean per utility type |
| `listing_media` | Media files with order/caption (replaces images array) |
| `contracts` | Lease template per listing_unit |
| `applications` | Student applications to listing units |
| `action_logs` | Append-only audit trail for every mutation |

**New FK columns on existing tables:**
- `users.school_id` → `schools.id`
- `listings.school_id` → `schools.id`
- `listings.primary_landlord_id` → `users.id`

---

## Phase 1 — SQL Migration (`scripts/v2-migration.sql`)

Run in 4 sub-phases. Sub-phases 1A–1C are safe to run any time (additive only). Sub-phase 1D (column drops) only after app code is fully updated (Steps 7–8).

### Sub-phase 1A: New Tables (Additive)

```sql
-- ─── schools ───────────────────────────────────────────────────────────────
create table if not exists schools (
  id         uuid        primary key default gen_random_uuid(),
  name       text        not null,
  short_name text,
  city       text,
  state      text,
  latitude   numeric(10,7),
  longitude  numeric(11,7),
  website    text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger if not exists trg_schools_updated_at
  before update on schools for each row execute function set_updated_at();

-- Seed WashU
insert into schools (name, short_name, city, state, latitude, longitude, website)
values ('Washington University in St. Louis', 'WashU', 'St. Louis', 'MO',
        38.6488, -90.3108, 'https://wustl.edu')
on conflict do nothing;

-- ─── school_id FK columns ──────────────────────────────────────────────────
alter table users    add column if not exists school_id uuid references schools(id) on delete set null;
alter table listings add column if not exists school_id uuid references schools(id) on delete set null;

-- ─── primary_landlord_id (replaces landlord_id array) ─────────────────────
alter table listings add column if not exists primary_landlord_id uuid references users(id) on delete set null;

-- ─── listing_landlords junction ────────────────────────────────────────────
create table if not exists listing_landlords (
  listing_id  uuid        not null references listings(id) on delete cascade,
  landlord_id uuid        not null references users(id)   on delete cascade,
  assigned_at timestamptz not null default now(),
  primary key (listing_id, landlord_id)
);
create index if not exists idx_ll_listing  on listing_landlords(listing_id);
create index if not exists idx_ll_landlord on listing_landlords(landlord_id);

-- ─── amenities lookup ──────────────────────────────────────────────────────
create table if not exists amenities (
  id       uuid primary key default gen_random_uuid(),
  name     text not null unique,
  category text check (category in ('outdoor','indoor','building','parking','other'))
);

-- ─── listing_amenities junction ────────────────────────────────────────────
create table if not exists listing_amenities (
  listing_id uuid not null references listings(id) on delete cascade,
  amenity_id uuid not null references amenities(id) on delete cascade,
  primary key (listing_id, amenity_id)
);
create index if not exists idx_la_listing  on listing_amenities(listing_id);
create index if not exists idx_la_amenity  on listing_amenities(amenity_id);

-- ─── listing_utilities (one row per listing, boolean per type) ─────────────
create table if not exists listing_utilities (
  id          uuid    primary key default gen_random_uuid(),
  listing_id  uuid    not null unique references listings(id) on delete cascade,
  water       boolean not null default false,
  electricity boolean not null default false,
  gas         boolean not null default false,
  internet    boolean not null default false,
  trash       boolean not null default false,
  cable       boolean not null default false,
  heating     boolean not null default false,
  cooling     boolean not null default false
);
create index if not exists idx_lu_listing on listing_utilities(listing_id);

-- ─── listing_media (additive — listings.images text[] kept for now) ────────
create table if not exists listing_media (
  id            uuid        primary key default gen_random_uuid(),
  listing_id    uuid        not null references listings(id) on delete cascade,
  url           text        not null,
  display_order int         not null default 0,
  caption       text,
  media_type    text        not null default 'image' check (media_type in ('image','video')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger if not exists trg_listing_media_updated_at
  before update on listing_media for each row execute function set_updated_at();
create index if not exists idx_lm_listing on listing_media(listing_id);

-- ─── contracts (lease template per listing_unit) ───────────────────────────
create table if not exists contracts (
  id                       uuid        primary key default gen_random_uuid(),
  listing_unit_id          uuid        not null references listing_units(id) on delete cascade,
  listing_id               uuid        not null references listings(id),
  move_in_date             timestamptz,
  duration_months          int,
  rent                     numeric,
  security_deposit         numeric,
  sublease_allowed         boolean     not null default false,
  late_fee_amount          numeric,
  late_fee_grace_days      int,
  pet_allowed              boolean     not null default false,
  pet_deposit              numeric,
  smoking_allowed          boolean     not null default false,
  utilities_responsibility text        check (utilities_responsibility in ('tenant','landlord','split')),
  parking_included         boolean     not null default false,
  parking_details          text,
  lease_type               text        check (lease_type in ('10-month','12-month','semester','summer')),
  status                   text        not null default 'active' check (status in ('active','draft','inactive')),
  custom_terms             text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
create trigger if not exists trg_contracts_updated_at
  before update on contracts for each row execute function set_updated_at();
create index if not exists idx_con_unit    on contracts(listing_unit_id);
create index if not exists idx_con_listing on contracts(listing_id);
create index if not exists idx_con_status  on contracts(status);

-- ─── applications ──────────────────────────────────────────────────────────
create table if not exists applications (
  id              uuid        primary key default gen_random_uuid(),
  listing_id      uuid        not null references listings(id) on delete cascade,
  listing_unit_id uuid        references listing_units(id) on delete set null,
  contract_id     uuid        references contracts(id) on delete set null,
  user_id         uuid        not null references users(id) on delete cascade,
  status          text        not null default 'pending'
                              check (status in ('pending','approved','rejected','withdrawn')),
  message         text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create trigger if not exists trg_applications_updated_at
  before update on applications for each row execute function set_updated_at();
create index if not exists idx_app_listing on applications(listing_id);
create index if not exists idx_app_user    on applications(user_id);
create index if not exists idx_app_status  on applications(status);

-- ─── action_logs (append-only, no updated_at) ─────────────────────────────
create table if not exists action_logs (
  id                   uuid        primary key default gen_random_uuid(),
  table_name           text        not null,
  row_id               text        not null,
  action_type          text        not null check (action_type in ('INSERT','UPDATE','DELETE')),
  changed_by_user_id   uuid        references users(id) on delete set null,
  changed_by_user_name text,
  changed_data         jsonb,
  -- Structure: { before: {field: value}, after: {field: value} }
  -- before=null for INSERT, after=null for DELETE
  created_at           timestamptz not null default now()
);
create index if not exists idx_al_table   on action_logs(table_name);
create index if not exists idx_al_row     on action_logs(row_id);
create index if not exists idx_al_action  on action_logs(action_type);
create index if not exists idx_al_created on action_logs(created_at desc);

-- ─── Indexes for new FK columns ────────────────────────────────────────────
create index if not exists idx_users_school_id           on users(school_id);
create index if not exists idx_listings_school_id        on listings(school_id);
create index if not exists idx_listings_primary_landlord on listings(primary_landlord_id);
```

### Sub-phase 1B: Data Migration

```sql
-- Migrate landlord_id → listing_landlords + primary_landlord_id
-- ⚠️ Assumes scalar uuid. If column is actually uuid[], change rec.landlord_id
--    to rec.landlord_id[1] for primary and loop the array for all.
do $$
declare
  rec record;
begin
  for rec in
    select id, landlord_id from listings where landlord_id is not null
  loop
    update listings
      set primary_landlord_id = rec.landlord_id
      where id = rec.id and primary_landlord_id is null;

    insert into listing_landlords (listing_id, landlord_id)
    values (rec.id, rec.landlord_id)
    on conflict do nothing;
  end loop;
end;
$$;

-- Seed amenities from existing amenities text[] values
insert into amenities (name)
select distinct unnest(amenities) from listings
where amenities is not null and amenities != '{}'
on conflict (name) do nothing;

-- Populate listing_amenities
insert into listing_amenities (listing_id, amenity_id)
select l.id, a.id
from listings l join amenities a on a.name = any(l.amenities)
where l.amenities is not null and l.amenities != '{}'
on conflict do nothing;

-- Populate listing_utilities
insert into listing_utilities (listing_id, water, electricity, gas, internet, trash, cable, heating, cooling)
select
  id,
  'water'       = any(utilities_included),
  ('electricity' = any(utilities_included) or 'electric' = any(utilities_included)),
  'gas'         = any(utilities_included),
  'internet'    = any(utilities_included),
  'trash'       = any(utilities_included),
  'cable'       = any(utilities_included),
  ('heating'    = any(utilities_included) or 'hotWater' = any(utilities_included)),
  ('cooling'    = any(utilities_included) or 'ac'       = any(utilities_included))
from listings
where utilities_included is not null and utilities_included != '{}'
on conflict (listing_id) do nothing;

-- Populate listing_media from images text[]
insert into listing_media (listing_id, url, display_order, media_type)
select l.id, img.url, img.ord::int, 'image'
from listings l,
     lateral unnest(l.images) with ordinality as img(url, ord)
where l.images is not null and l.images != '{}'
on conflict do nothing;

-- Migrate lease fields → contracts (one per listing_unit)
insert into contracts (listing_unit_id, listing_id, move_in_date, rent, sublease_allowed, lease_type, status)
select
  lu.id,
  lu.listing_id,
  case when l.move_in_date ~ '^\d{4}-\d{2}-\d{2}' then l.move_in_date::timestamptz else null end,
  lu.rent,
  coalesce(l.sublease_friendly, false),
  lu.lease_availability,
  'active'
from listing_units lu
join listings l on l.id = lu.listing_id
on conflict do nothing;
```

### Sub-phase 1C: Update `sync_listing_aggregates` Trigger

```sql
-- Updated trigger: min/max rent from contracts (with fallback to listing_units.rent)
create or replace function sync_listing_aggregates()
returns trigger language plpgsql as $$
declare target_id uuid;
begin
  target_id := case when tg_op = 'DELETE' then old.listing_id else new.listing_id end;
  update listings set
    min_rent      = (select min(coalesce(c.rent, lu.rent)) from listing_units lu
                     left join contracts c on c.listing_unit_id = lu.id and c.status = 'active'
                     where lu.listing_id = target_id),
    max_rent      = (select max(coalesce(c.rent, lu.rent)) from listing_units lu
                     left join contracts c on c.listing_unit_id = lu.id and c.status = 'active'
                     where lu.listing_id = target_id),
    min_bedrooms  = (select min(bedrooms)  from listing_units where listing_id = target_id),
    max_bedrooms  = (select max(bedrooms)  from listing_units where listing_id = target_id),
    min_bathrooms = (select min(bathrooms) from listing_units where listing_id = target_id),
    max_bathrooms = (select max(bathrooms) from listing_units where listing_id = target_id),
    min_area      = (select min(area)      from listing_units where listing_id = target_id),
    max_area      = (select max(area)      from listing_units where listing_id = target_id),
    updated_at    = now()
  where id = target_id;
  return null;
end;
$$;

-- New trigger: contracts changes also recompute listing min/max rent
create or replace function sync_aggregates_from_contracts()
returns trigger language plpgsql as $$
declare target_id uuid;
begin
  target_id := case when tg_op = 'DELETE' then old.listing_id else new.listing_id end;
  update listings set
    min_rent = (select min(coalesce(c.rent, lu.rent)) from listing_units lu
                left join contracts c on c.listing_unit_id = lu.id and c.status = 'active'
                where lu.listing_id = target_id),
    max_rent = (select max(coalesce(c.rent, lu.rent)) from listing_units lu
                left join contracts c on c.listing_unit_id = lu.id and c.status = 'active'
                where lu.listing_id = target_id),
    updated_at = now()
  where id = target_id;
  return null;
end;
$$;

drop trigger if exists trg_sync_aggregates_contracts on contracts;
create trigger trg_sync_aggregates_contracts
  after insert or update or delete on contracts
  for each row execute function sync_aggregates_from_contracts();
```

### Sub-phase 1D: Column Drops (Deferred)

**Run only after Steps 7–8 are complete and validated.**

```sql
-- alter table listings drop column if exists landlord_id;
-- alter table listings drop column if exists amenities;
-- alter table listings drop column if exists utilities_included;
-- alter table listings drop column if exists lease_structure;
-- alter table listings drop column if exists move_in_date;
-- alter table listings drop column if exists sublease_friendly;
-- alter table listing_units drop column if exists lease_availability;
-- alter table listing_units drop column if exists rent;
```

---

## Phase 2 — `app/api/admin/[table]/route.js`

### 2A: Add `insertActionLog` helper

Add after the existing email helper functions, before `getDbTarget`:

```js
async function insertActionLog(supabase, { tableName, rowId, actionType, userId, userName, before, after }) {
  try {
    await supabase.from("action_logs").insert({
      table_name: tableName,
      row_id: String(rowId),
      action_type: actionType,
      changed_by_user_id: userId ?? null,
      changed_by_user_name: userName ?? null,
      changed_data: { before: before ?? null, after: after ?? null },
    });
  } catch (err) {
    console.error("[action_log]", err?.message); // non-fatal — never fail main request
  }
}
```

### 2B: `PATCH` handler changes

1. At the top of PATCH, **fetch before-state** (replaces the existing partial landlord-diff fetch):
   ```js
   const { data: beforeRow } = await supabase.from(table).select("*").eq("id", id).maybeSingle();
   ```
2. Extend email notification logic to also handle `primary_landlord_id` changes (same pattern as existing `landlord_id` block).
3. After successful update, add:
   ```js
   await insertActionLog(supabase, { tableName: table, rowId: id, actionType: "UPDATE",
     userId: session.user.id, userName: session.user.name, before: beforeRow, after: data });
   ```
4. Add guard for `listing_landlords` (composite PK, no `id` column):
   ```js
   if (table === "listing_landlords") return Response.json({ error: "Use listing editor to manage landlords" }, { status: 400 });
   ```

### 2C: `POST` handler changes

After successful insert:
```js
await insertActionLog(supabase, { tableName: table, rowId: data.id, actionType: "INSERT",
  userId: session.user.id, userName: session.user.name, before: null, after: data });
```

### 2D: `DELETE` handler changes

Before delete, fetch before-state. After successful delete:
```js
await insertActionLog(supabase, { tableName: table, rowId: id, actionType: "DELETE",
  userId: session.user.id, userName: session.user.name, before: beforeRow, after: null });
```

---

## Phase 3 — `app/dashboard/admin/page.js`

### 3A: Add to `SCHEMAS` object

Add 9 new schema entries after `matchmaking_responses`:

```js
schools: [
  { key: "id", label: "ID", type: "id" },
  { key: "name", label: "Name", type: "text", required: true },
  { key: "short_name", label: "Short Name", type: "text" },
  { key: "city", label: "City", type: "text" },
  { key: "state", label: "State", type: "text" },
  { key: "latitude", label: "Latitude", type: "number" },
  { key: "longitude", label: "Longitude", type: "number" },
  { key: "website", label: "Website", type: "text" },
  { key: "created_at", label: "Created", type: "readonly" },
  { key: "updated_at", label: "Updated", type: "readonly" },
],
listing_landlords: [
  { key: "listing_id", label: "Listing ID", type: "text", required: true },
  { key: "landlord_id", label: "Landlord", type: "user-search", required: true },
  { key: "assigned_at", label: "Assigned At", type: "readonly" },
],
amenities: [
  { key: "id", label: "ID", type: "id" },
  { key: "name", label: "Name", type: "text", required: true },
  { key: "category", label: "Category", type: "enum", options: ["outdoor","indoor","building","parking","other"] },
],
listing_amenities: [
  { key: "listing_id", label: "Listing ID", type: "text", required: true },
  { key: "amenity_id", label: "Amenity ID", type: "text", required: true },
],
listing_utilities: [
  { key: "id", label: "ID", type: "id" },
  { key: "listing_id", label: "Listing ID", type: "text", required: true },
  { key: "water", label: "Water", type: "boolean" },
  { key: "electricity", label: "Electricity", type: "boolean" },
  { key: "gas", label: "Gas", type: "boolean" },
  { key: "internet", label: "Internet", type: "boolean" },
  { key: "trash", label: "Trash", type: "boolean" },
  { key: "cable", label: "Cable", type: "boolean" },
  { key: "heating", label: "Heating", type: "boolean" },
  { key: "cooling", label: "Cooling", type: "boolean" },
],
listing_media: [
  { key: "id", label: "ID", type: "id" },
  { key: "listing_id", label: "Listing ID", type: "text", required: true },
  { key: "url", label: "URL", type: "text", required: true },
  { key: "display_order", label: "Order", type: "number" },
  { key: "caption", label: "Caption", type: "text" },
  { key: "media_type", label: "Type", type: "enum", options: ["image","video"] },
  { key: "created_at", label: "Created", type: "readonly" },
],
contracts: [
  { key: "id", label: "ID", type: "id" },
  { key: "listing_unit_id", label: "Unit ID", type: "text", required: true },
  { key: "listing_id", label: "Listing ID", type: "text", required: true },
  { key: "move_in_date", label: "Move-In Date", type: "date" },
  { key: "duration_months", label: "Duration (months)", type: "number" },
  { key: "rent", label: "Rent ($)", type: "number" },
  { key: "security_deposit", label: "Security Deposit ($)", type: "number" },
  { key: "sublease_allowed", label: "Sublease Allowed", type: "boolean" },
  { key: "late_fee_amount", label: "Late Fee ($)", type: "number" },
  { key: "late_fee_grace_days", label: "Late Fee Grace Days", type: "number" },
  { key: "pet_allowed", label: "Pets Allowed", type: "boolean" },
  { key: "pet_deposit", label: "Pet Deposit ($)", type: "number" },
  { key: "smoking_allowed", label: "Smoking Allowed", type: "boolean" },
  { key: "utilities_responsibility", label: "Utilities", type: "enum", options: ["tenant","landlord","split"] },
  { key: "parking_included", label: "Parking Included", type: "boolean" },
  { key: "parking_details", label: "Parking Details", type: "text" },
  { key: "lease_type", label: "Lease Type", type: "enum", options: ["10-month","12-month","semester","summer"] },
  { key: "status", label: "Status", type: "enum", options: ["active","draft","inactive"] },
  { key: "custom_terms", label: "Custom Terms", type: "text" },
  { key: "created_at", label: "Created", type: "readonly" },
  { key: "updated_at", label: "Updated", type: "readonly" },
],
applications: [
  { key: "id", label: "ID", type: "id" },
  { key: "listing_id", label: "Listing", type: "text", required: true },
  { key: "listing_unit_id", label: "Unit", type: "text" },
  { key: "contract_id", label: "Contract", type: "text" },
  { key: "user_id", label: "Applicant", type: "user-search", required: true },
  { key: "status", label: "Status", type: "enum", options: ["pending","approved","rejected","withdrawn"] },
  { key: "message", label: "Message", type: "text" },
  { key: "created_at", label: "Created", type: "readonly" },
  { key: "updated_at", label: "Updated", type: "readonly" },
],
action_logs: [
  // All readonly — this table is never edited
  { key: "id", label: "ID", type: "id" },
  { key: "table_name", label: "Table", type: "readonly" },
  { key: "row_id", label: "Row ID", type: "readonly" },
  { key: "action_type", label: "Action", type: "readonly" },
  { key: "changed_by_user_name", label: "Changed By", type: "readonly" },
  { key: "changed_by_user_id", label: "User ID", type: "readonly" },
  { key: "changed_data", label: "Diff", type: "json" },
  { key: "created_at", label: "When", type: "readonly" },
],
```

Also add to `listings` schema:
```js
{ key: "primary_landlord_id", label: "Primary Landlord", type: "user-search" },
{ key: "school_id", label: "School", type: "text" },
```

Add to `users` schema:
```js
{ key: "school_id", label: "School", type: "text" },
```

### 3B: New `RowDetailModal` component

Add before `export default function AdminDashboard`. Key design:
- `fixed inset-0 z-50 bg-black/60` backdrop; click backdrop to close
- Centered white card `max-w-2xl max-h-[90vh] flex flex-col`
- **Header**: table name + `row.id.slice(0,8)…` + close X
- **Body (read mode)**: field label + formatted value (timestamps → locale date, booleans → Yes/No, JSON → formatted block, UUIDs → truncated)
- **Footer (read mode)**: `Edit` button
- **Edit mode**: body fields use existing `<FieldInput>` components; `NEVER_EDIT = new Set(["id","created_at","updated_at","mongo_id"])`; amber border on changed fields
- **Footer (edit mode)**: `Cancel` + `Save` buttons; save calls `PATCH /api/admin/[tableName]`; prod double-confirm
- On save success: call `onSaved(updatedRow)`, exit edit mode

### 3C: New `ActionLogViewer` component

Add before `RowDetailModal`. Key design:
- Fetches from `GET /api/admin/action_logs` (with `x-db-target` header)
- Filter bar: table name dropdown + action type dropdown (INSERT/UPDATE/DELETE)
- Table: When | By | Table | Action | Row ID | Diff
- Click row to expand diff inline
- Diff: two-column before/after; keys that differ highlighted amber
- Action type badge colors: INSERT=green-600, UPDATE=blue-600, DELETE=red-600

### 3D: New `SchemaBrowserModal` component

Add before `ActionLogViewer`. Key design:
- `fixed inset-0 z-50` overlay, `max-w-5xl max-h-[90vh]`
- Two tabs: **List** | **ERD**
- **List tab**: for each table, a collapsible section showing columns (name, type, FK target). FK target inferred from column name (`listing_id` → listings, `user_id` → users, `school_id` → schools, etc.)
- **ERD tab**: SVG 960×900. Dark boxes for each table at hardcoded grid positions. Dashed SVG lines with arrowheads for FK relationships. Pure CSS/SVG, no library.

### 3E: Wire into `AdminDashboard`

**State additions:**
```js
const [detailRow, setDetailRow] = useState(null);
const [showActionLog, setShowActionLog] = useState(false);
const [showSchemaBrowser, setShowSchemaBrowser] = useState(false);
```

**Header changes:**
- Add `"Action Log"` toggle button after "Confirm Updates"
- Add `"Schema"` button that opens SchemaBrowserModal
- **Remove** column picker dropdown
- **Keep** search bar

**Table structure:**
- **Add Row button** moves to just above `<table>` (below search bar, above `<thead>`)
- `<tr>` rows: replace full inline cell editing with **minimal 3-column display** (truncated id + primary text field + created_at)
- `<tr>` gets `cursor-pointer hover:bg-blue-50 onClick={() => setDetailRow(row)}`
- Remove `pendingChanges` state and "Confirm Updates" flow for main table rows
- Keep "Confirm Updates" / `pendingChanges` flow **only inside `RowDetailModal`**

**Render at bottom of return:**
```jsx
{detailRow && (
  <RowDetailModal
    row={detailRow}
    tableName={activeTable}
    schema={schema}
    users={allUsers}
    dbTarget={dbTarget}
    isProd={isProd}
    onClose={() => setDetailRow(null)}
    onSaved={(r) => {
      setRows(prev => prev.map(x => x.id === r.id ? r : x));
      setDetailRow(r);
    }}
  />
)}
{showActionLog && (
  <div className="mt-6 bg-white rounded-xl border border-gray-200 shadow-sm p-4">
    <ActionLogViewer dbTarget={dbTarget} />
  </div>
)}
{showSchemaBrowser && (
  <SchemaBrowserModal schemas={SCHEMAS} allTables={allTables} onClose={() => setShowSchemaBrowser(false)} />
)}
```

---

## Implementation Order (Dependency Chain)

| Step | What | Depends On |
|---|---|---|
| **1** | Run SQL sub-phases 1A + 1B + 1C on **dev** | Nothing — safe, additive |
| **2** | Update `[table]/route.js` (action logging + guards) | Step 1 (`action_logs` table must exist) |
| **3** | Add new SCHEMAS to admin page | Step 1 (tables must exist for GET to work) |
| **4** | Add `RowDetailModal` + wire row click | Step 3 |
| **5** | Add `ActionLogViewer` + `SchemaBrowserModal` | Steps 2, 3 |
| **6** | Refactor table rows to minimal display; remove inline editing | Step 4 confirmed working |
| **7** | Update `app/api/listings/route.js` to use `primary_landlord_id` | Step 1 data migration confirmed |
| **8** | Update all other `landlord_id array` consumers (see list below) | Step 7 validated |
| **9** | Run SQL sub-phase 1D column drops | Steps 7 + 8 complete, validated in dev |

### Files touching `landlord_id` (Step 8)

All use `.contains("landlord_id", [userId])` or `landlord_id[0]` — switch to `primary_landlord_id` or `listing_landlords` join:

- `app/api/listings/route.js`
- `app/api/getUser/route.js`
- `app/api/addListing/route.js` — write `primary_landlord_id` + insert to `listing_landlords`
- `app/api/landlord/listings/route.js`
- `app/api/landlord/listings/[listingId]/route.js`
- `app/api/landlord/reviews/route.js`
- `app/api/landlord/metrics/route.js`
- `app/api/favorites/route.js`
- `app/api/contacted/route.js`
- `app/api/pendingReviews/route.js`
- `app/api/upload/route.js`
- `app/api/listing/[listingId]/route.js`
- `app/api/admin/viewUser/route.js`
- `app/api/webhooks/new-listing/route.js`
- `app/_landlord/[landlordId]/page.js`

For ownership checks: switch `.contains("landlord_id", [userId])` to:
```js
// Option A: primary only
.eq("primary_landlord_id", userId)

// Option B: primary + co-landlords (via junction)
const { data: ll } = await supabase.from("listing_landlords").select("listing_id").eq("landlord_id", userId);
const ids = (ll ?? []).map(r => r.listing_id);
// then .in("id", ids) on the listings query
```

---

## Verification Checklist

### After Step 1 (SQL)
```sql
select count(*) from listing_landlords;  -- matches non-null landlord_id listings
select count(*) from listing_amenities;  -- non-zero if listings had amenities
select count(*) from listing_utilities;  -- matches listings with utilities_included
select count(*) from listing_media;      -- matches total images across all listings
select count(*) from contracts;          -- matches listing_units count
select count(*) from schools;            -- 1 (WashU)
-- Spot-check: pick a listing, verify primary_landlord_id matches old landlord_id
```

### After Steps 2–6 (Admin UI)
1. All new tables appear in table selector dropdown
2. Click any row → RowDetailModal opens with all fields shown
3. Edit button → fields become inputs, IDs/timestamps stay read-only
4. Save → PATCH fires, row updates in list, modal reflects new values
5. Action Log button → viewer loads, shows entries after mutations
6. Schema button → List tab shows tables+columns+FK targets; ERD tab shows boxes+lines
7. `action_logs` table selected in admin → no Edit button in modal, no Delete button in row

### After Step 7
Students browsing listings can still filter by rent range (min_rent/max_rent still populated via updated trigger).
