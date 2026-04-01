# Database Architecture

## Overview

| Property | Value |
|----------|-------|
| **Primary database engine** | Supabase (PostgreSQL) — managed hosted PostgreSQL |
| **Secondary database** | SQLite (WAL mode) — local claude-flow agent coordination |
| **Application tables** | 9 (Supabase) |
| **Agent/tooling tables** | 9 (SQLite) |
| **Views / Materialized Views** | None |
| **Schemas (PostgreSQL namespaces)** | 1 (`public`) + Supabase managed `auth` schema (not documented here) |
| **High-level purpose** | Proximity is a student housing marketplace for Washington University in St. Louis. Students browse, save, and review off-campus rental listings. Landlords post and manage listings. A separate dorm-review section covers on-campus housing. |
| **Document generated** | 2026-04-01 |
| **Migration status** | Active — migrating from MongoDB/Mongoose to Supabase PostgreSQL. `mongo_id` columns and dual-write patterns are present throughout. |

---

## Domain Map

| Domain | Tables | Description |
|--------|--------|-------------|
| **Users & Auth** | `users` | Student and landlord accounts; profile data |
| **Listings** | `listings`, `listing_units` | Rental property listings and their per-unit breakdowns |
| **Reviews** | `reviews` | Student reviews of rental listings with moderation workflow |
| **On-Campus Housing** | `dorms`, `dorm_reviews` | University dormitory catalog and anonymous reviews |
| **Social** | `user_favorites`, `user_contacted` | Many-to-many engagement tracking (saves and contacts) |
| **Marketing** | `testimonials` | Platform-level testimonials for marketing pages |
| **Agent Memory (SQLite)** | `memory_entries`, `patterns`, `pattern_history`, `trajectories`, `trajectory_steps`, `migration_state`, `sessions`, `vector_indexes`, `metadata` | RuFlo V3 claude-flow development tooling — not application data |

---

## Entity Relationship Summary

A **User** belongs to one of three roles: `student`, `landlord`, or `super` (admin). Users are created and authenticated by NextAuth.js via Google OAuth (currently backed by a separate MongoDB auth store; the application profile data now lives in Supabase).

A **Listing** represents a rental property. It is optionally owned by a landlord User via `landlord_id`. Listings that originate from data imports or external sources may have no landlord account and instead carry plain-text `contact_email`, `contact_phone`, and `contact_name` fields. A listing contains one or more **Listing Units** — each unit is a distinct rentable floor plan (e.g., "Studio A", "2BR Unit 3") with its own bedroom count, bathroom count, rent, and area. A PostgreSQL trigger automatically keeps aggregate `min_rent`, `max_rent`, `min_bedrooms`, `max_bedrooms`, `min_bathrooms`, `max_bathrooms`, `min_area`, and `max_area` columns on the parent listing in sync whenever units are inserted, updated, or deleted.

Students write **Reviews** about listings they have lived in. Each review is initially flagged `legitimacy = false` (pending). The listing's landlord reviews pending submissions via the admin panel and approves or rejects them. Approval sets `legitimacy = true` and triggers an application-level recalculation of the listing's `num_reviews` and `rating` aggregates.

A student can **Favorite** a listing — recorded in `user_favorites` — which increments `listings.num_saves`. When a student submits the contact form for a landlord, the event is recorded in `user_contacted` (idempotent upsert). Neither counter is trigger-managed; both are maintained via application-level read-modify-write.

**Dorms** are a static catalog of on-campus university housing. **Dorm Reviews** are anonymous (no user account required) and are posted directly without a moderation step.

**Testimonials** are platform-level quotes shown on marketing pages with no relational ties.

---

## Domains

### Users & Auth

#### `users`
- **Purpose:** Stores all application user accounts — students, landlords, and super-admins. Created on first Google OAuth sign-in; profile fields are filled in via the edit-profile flow.
- **Row count:** Low (hundreds of records expected at current scale)
- **Columns:**

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | uuid | NO | `gen_random_uuid()` | Primary key |
| `mongo_id` | text | YES | — | Legacy MongoDB ObjectId; migration artifact |
| `name` | text | YES | — | Display name from Google profile |
| `email` | text | YES | — | Unique email address |
| `image` | text | YES | — | Profile photo URL (Cloudflare R2 or Google CDN) |
| `role` | text | NO | `'student'` | Enum: `student`, `landlord`, `super` |
| `birthday` | timestamptz | YES | — | User-supplied date of birth |
| `description` | text | NO | `''` | Free-text bio |
| `gender` | text | NO | `'unspecified'` | Self-identified gender |
| `num_reviews` | int | NO | `0` | Count of reviews this user has written |
| `phone` | text | NO | `'N/A'` | Phone number (display only) |
| `profile_complete` | boolean | NO | `false` | Whether the user has finished onboarding |
| `rating` | numeric(3,2) | NO | `0` | Average rating as a landlord (0–5) |
| `referral_source` | text | NO | `''` | How the user heard about Proximity |
| `created_at` | timestamptz | NO | `now()` | Account creation timestamp |
| `updated_at` | timestamptz | NO | `now()` | Last update; auto-managed by trigger |

- **Indexes:**
  - Primary key on `id`
  - Unique index on `email`
  - Unique index on `mongo_id`
- **Constraints:**
  - `role CHECK (role IN ('student', 'landlord', 'super'))`
  - `rating CHECK (rating >= 0 AND rating <= 5)`
- **Relationships:**
  - Referenced by: `listings.landlord_id`, `reviews.user_id`, `user_favorites.user_id`, `user_contacted.user_id`
- **Notable patterns:** Audit columns (`created_at`, `updated_at`). Migration artifact (`mongo_id`). The `rating` and `num_reviews` fields here appear to be for landlord reputation but are not computed by any trigger — currently not actively written by any API route found in the codebase.

---

### Listings

#### `listings`
- **Purpose:** Core table for rental properties. Stores listing-level metadata, geolocation, contact info, engagement metrics, and aggregate min/max values derived from `listing_units`.
- **Row count:** Medium (tens to low hundreds expected)
- **Columns:**

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | uuid | NO | `gen_random_uuid()` | Primary key |
| `mongo_id` | text | YES | — | Legacy MongoDB ObjectId; migration artifact |
| `title` | text | YES | — | Optional display title |
| `address` | text | NO | — | Full street address |
| `longitude` | numeric(11,7) | NO | — | Geocoded longitude (via Mapbox) |
| `latitude` | numeric(10,7) | NO | — | Geocoded latitude (via Mapbox) |
| `description` | text | NO | — | Markdown/plain description |
| `home_type` | text | NO | `'apartment'` | Enum: `house`, `apartment`, `condo`, `townhouse` |
| `lease_type` | text | NO | — | E.g., `standard`, `sublease` |
| `images` | text[] | NO | `'{}'` | Array of Cloudflare R2 public URLs |
| `place_walk_minutes` | jsonb | NO | `'{}'` | Map of campus place names → walk-time in minutes, e.g. `{"Olin Library": 8}` |
| `shuttle_walk_minutes` | int | YES | — | Minutes to nearest shuttle stop |
| `contact_email` | text | YES | — | Off-platform landlord email |
| `contact_phone` | text | YES | — | Off-platform landlord phone |
| `contact_name` | text | YES | — | Off-platform landlord name |
| `num_reviews` | int | NO | `0` | Count of approved reviews; maintained by app code |
| `rating` | numeric(3,2) | NO | `0` | Avg of approved review ratings; app-maintained |
| `num_clicks` | int | NO | `0` | Total detail-page views; app-maintained |
| `num_saves` | int | NO | `0` | Count of users who have favorited; app-maintained |
| `min_rent` | numeric | YES | — | Trigger-computed minimum rent across units |
| `max_rent` | numeric | YES | — | Trigger-computed maximum rent across units |
| `min_bedrooms` | int | YES | — | Trigger-computed minimum bedroom count |
| `max_bedrooms` | int | YES | — | Trigger-computed maximum bedroom count |
| `min_bathrooms` | numeric | YES | — | Trigger-computed minimum bathroom count |
| `max_bathrooms` | numeric | YES | — | Trigger-computed maximum bathroom count |
| `min_area` | numeric | YES | — | Trigger-computed minimum sq footage |
| `max_area` | numeric | YES | — | Trigger-computed maximum sq footage |
| `landlord_id` | uuid | YES | — | FK → `users.id`; null for off-platform landlords |
| `created_at` | timestamptz | NO | `now()` | Creation timestamp |
| `updated_at` | timestamptz | NO | `now()` | Last update; auto-managed by trigger |
| `furnished` | boolean | NO | `false` | **Being migrated up** from `listing_units` |
| `utilities_included` | text[] | NO | `'{}'` | **Being migrated up** — e.g. `{water,trash,internet}` |
| `lease_structure` | text | YES | — | **Being migrated up** — enum: `individual`, `joint` |
| `move_in_date` | text | YES | — | **Being migrated up** — free-text date |
| `sublease_friendly` | boolean | NO | `false` | **Being migrated up** from `listing_units` |
| `amenities` | text[] | NO | `'{}'` | **Being migrated up** — canonical snake_case values |
| `unavailable` | boolean | NO | `false` | **Being migrated up** — true if all units unavailable |

- **Indexes:**
  - Primary key on `id`
  - `listings_landlord_id_idx` — btree on `landlord_id`
  - `listings_home_type_idx` — btree on `home_type`
  - `listings_lease_type_idx` — btree on `lease_type`
  - `listings_latitude_longitude_idx` — btree on `(latitude, longitude)` — supports geo queries
  - `listings_min_rent_max_rent_idx` — btree on `(min_rent, max_rent)` — supports rent-range filtering
- **Constraints:**
  - `home_type CHECK (home_type IN ('house', 'apartment', 'condo', 'townhouse'))`
  - `rating CHECK (rating >= 0 AND rating <= 5)`
  - `lease_structure CHECK (lease_structure IN ('individual', 'joint'))` (on migrated column)
- **Relationships:**
  - References: `landlord_id` → `users.id` (ON DELETE SET NULL)
  - Referenced by: `listing_units.listing_id`, `reviews.listing_id`, `user_favorites.listing_id`, `user_contacted.listing_id`
- **Notable patterns:**
  - **JSONB column** — `place_walk_minutes` stores a dynamic map of campus location names to integer walk times (populated via Mapbox Walking API on listing creation and via admin bulk-update endpoint).
  - **Computed aggregates** — `min_rent` / `max_rent` etc. are read-only from the application's perspective; maintained entirely by `trg_sync_listing_aggregates`.
  - **Application-level counters** — `num_saves`, `num_clicks`, `num_reviews`, `rating` use optimistic read-modify-write; no triggers or advisory locks protect against concurrent increment races.
  - **In-progress field migration** — The seven columns marked "Being migrated up" were added via `docs/migrate-listing-fields.sql`. The `DROP COLUMN` step on `listing_units` (Step 3) is present in the script but was left commented out, meaning both tables currently carry these fields during the transition window.
  - Audit columns (`created_at`, `updated_at`).

---

#### `listing_units`
- **Purpose:** One row per distinct rentable unit configuration within a listing. Drives the aggregate columns on `listings` via trigger. After the in-progress migration completes, this table will hold only per-unit size, price, and availability.
- **Row count:** Slightly higher than `listings` (avg ~1–3 units per listing)
- **Columns:**

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | uuid | NO | `gen_random_uuid()` | Primary key |
| `listing_id` | uuid | NO | — | FK → `listings.id` (ON DELETE CASCADE) |
| `name` | text | YES | — | Unit label, e.g. "Studio A". **Pending drop** per migration |
| `bedrooms` | int | NO | — | Number of bedrooms |
| `bathrooms` | numeric | NO | — | Number of bathrooms (0.5 increments allowed) |
| `rent` | numeric | YES | — | Monthly rent in USD |
| `area` | numeric | YES | — | Square footage |
| `furnished` | boolean | NO | `false` | **Pending drop** — moving to `listings` |
| `utilities_included` | text[] | NO | `'{}'` | **Pending drop** — moving to `listings` |
| `lease_availability` | text | YES | — | Stays per-unit: `semester`, `10-month`, `12-month` |
| `lease_structure` | text | YES | — | **Pending drop** — moving to `listings` |
| `move_in_date` | text | YES | — | **Pending drop** — moving to `listings` |
| `sublease_friendly` | boolean | NO | `false` | **Pending drop** — moving to `listings` |
| `amenities` | text[] | NO | `'{}'` | **Pending drop** — moving to `listings` |
| `unavailable` | boolean | NO | `false` | **Pending drop** — moving to `listings` |
| `created_at` | timestamptz | NO | `now()` | Creation timestamp |
| `updated_at` | timestamptz | NO | `now()` | Last update; auto-managed by trigger |

- **Indexes:**
  - Primary key on `id`
  - `listing_units_listing_id_idx` — btree on `listing_id`
  - `listing_units_unavailable_idx` — btree on `unavailable`
  - `listing_units_bedrooms_idx` — btree on `bedrooms`
  - `listing_units_rent_idx` — btree on `rent`
- **Constraints:**
  - `lease_availability CHECK (lease_availability IN ('semester', '10-month', '12-month'))`
  - `lease_structure CHECK (lease_structure IN ('individual', 'joint'))`
- **Relationships:**
  - References: `listing_id` → `listings.id` (ON DELETE CASCADE)
  - Referenced by: `trg_sync_listing_aggregates` trigger fires on mutations here
- **Notable patterns:**
  - After the migration's Step 3 executes, `listing_units` will only carry `id`, `listing_id`, `bedrooms`, `bathrooms`, `rent`, `area`, `lease_availability`, `created_at`, `updated_at` — a much leaner table.
  - Deletion cascades from `listings` eliminate the need for explicit cleanup.

---

### Reviews

#### `reviews`
- **Purpose:** Student-submitted reviews of rental listings. New reviews require landlord approval before counting toward the listing's rating.
- **Row count:** Low (dozens to low hundreds expected)
- **Columns:**

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | uuid | NO | `gen_random_uuid()` | Primary key |
| `mongo_id` | text | YES | — | Legacy MongoDB ObjectId; migration artifact |
| `user_id` | uuid | NO | — | FK → `users.id` (ON DELETE CASCADE) |
| `listing_id` | uuid | NO | — | FK → `listings.id` (ON DELETE CASCADE) |
| `rating` | numeric(3,2) | NO | — | Overall rating 0–5 |
| `comment` | text | NO | — | Review body text |
| `legitimacy` | boolean | NO | `false` | Moderation flag: false = pending, true = approved |
| `communication_rating` | int | YES | — | Sub-rating: communication quality (1–5) |
| `location_rating` | int | YES | — | Sub-rating: location quality (1–5) |
| `value_rating` | int | YES | — | Sub-rating: value for money (1–5) |
| `created_at` | timestamptz | NO | `now()` | Submission timestamp |
| `updated_at` | timestamptz | NO | `now()` | Auto-managed by trigger |

- **Indexes:**
  - Primary key on `id`
  - `reviews_listing_id_idx` — btree on `listing_id`
  - `reviews_user_id_idx` — btree on `user_id`
  - Unique index on `(user_id, listing_id)` — one review per user per listing
- **Constraints:**
  - `rating CHECK (rating >= 0 AND rating <= 5)`
  - `communication_rating CHECK (communication_rating BETWEEN 1 AND 5)`
  - `location_rating CHECK (location_rating BETWEEN 1 AND 5)`
  - `value_rating CHECK (value_rating BETWEEN 1 AND 5)`
  - `UNIQUE (user_id, listing_id)`
- **Relationships:**
  - References: `user_id` → `users.id`, `listing_id` → `listings.id`
- **Notable patterns:**
  - **Soft moderation queue** via `legitimacy` boolean. All inserts default to `false`. The `GET /api/pendingReviews` endpoint exposes these to the landlord; PATCH approves, DELETE removes.
  - When a review is approved or deleted, application code in `pendingReviews/route.js` manually recalculates and writes `listings.num_reviews` and `listings.rating` from all remaining approved reviews. This is not trigger-driven.

---

### On-Campus Housing

#### `dorms`
- **Purpose:** Static catalog of Washington University dormitory buildings. Serves as the reference table for dorm reviews.
- **Row count:** Very low (< 30 records expected; one per dorm building)
- **Columns:**

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | uuid | NO | `gen_random_uuid()` | Primary key |
| `mongo_id` | text | YES | — | Migration artifact |
| `name` | text | NO | — | Unique dorm building name |
| `room_types` | text[] | NO | `'{}'` | Room type options at this dorm |
| `description` | text | NO | `''` | Description of the dorm |
| `tags` | text[] | NO | `'{}'` | Categorical tags (e.g., "quiet", "social") |
| `image` | text | YES | — | Cover image URL |
| `created_at` | timestamptz | NO | `now()` | Row creation timestamp |
| `updated_at` | timestamptz | NO | `now()` | Auto-managed by trigger |

- **Indexes:**
  - Primary key on `id`
  - Unique index on `name`
- **Relationships:**
  - Referenced by: `dorm_reviews.dorm_id`
- **Notable patterns:** Lookups in the API always resolve dorm by `name` (not UUID) — `GET /api/dormReviews?dorm=<name>` and `POST /api/dormReviews` both do a `name → id` lookup before querying `dorm_reviews`. No index on `name` beyond the unique constraint.

---

#### `dorm_reviews`
- **Purpose:** Anonymous student reviews of dormitory buildings. No user account is required — submitters enter their name as free text.
- **Row count:** Low to medium (dozens expected)
- **Columns:**

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | uuid | NO | `gen_random_uuid()` | Primary key |
| `mongo_id` | text | YES | — | Migration artifact |
| `dorm_id` | uuid | NO | — | FK → `dorms.id` (ON DELETE CASCADE) |
| `reviewer_name` | text | NO | — | Free-text name (unauthenticated) |
| `class_year` | int | NO | — | Submitter's graduation year |
| `rating` | numeric(3,2) | NO | — | Overall rating 1–5 |
| `dorm_type` | text | NO | `''` | Type of room (maps from `dorms.room_types`) |
| `tags` | text[] | NO | `'{}'` | Reviewer-selected experience tags |
| `content` | text | NO | — | Review body text |
| `created_at` | timestamptz | NO | `now()` | Submission timestamp |
| `updated_at` | timestamptz | NO | `now()` | Auto-managed by trigger |

- **Indexes:**
  - Primary key on `id`
  - `dorm_reviews_dorm_id_idx` — btree on `dorm_id`
- **Constraints:**
  - `rating CHECK (rating >= 1 AND rating <= 5)`
- **Relationships:**
  - References: `dorm_id` → `dorms.id` (ON DELETE CASCADE)
- **Notable patterns:** No moderation step (unlike listing `reviews`). No user account linkage — reviewer identity is entirely unverified.

---

### Social

#### `user_favorites`
- **Purpose:** Junction table recording which listings a student has saved/favorited. Also drives the `listings.num_saves` counter.
- **Row count:** Low (handful per active user)
- **Columns:**

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `user_id` | uuid | NO | — | FK → `users.id` (ON DELETE CASCADE) |
| `listing_id` | uuid | NO | — | FK → `listings.id` (ON DELETE CASCADE) |
| `created_at` | timestamptz | NO | `now()` | When the listing was saved |

- **Indexes:**
  - Composite primary key `(user_id, listing_id)`
  - `user_favorites_user_id_idx` — btree on `user_id`
  - `user_favorites_listing_id_idx` — btree on `listing_id`
- **Relationships:**
  - References: `user_id` → `users.id`, `listing_id` → `listings.id`
- **Notable patterns:** The `favorites/route.js` endpoint implements a toggle — it checks for an existing row, deletes it (unfavorite) or inserts it (favorite), and manually increments/decrements `listings.num_saves` accordingly.

---

#### `user_contacted`
- **Purpose:** Idempotent log of which listings a student has contacted. Used to populate the "contacted" list in the user profile.
- **Row count:** Low
- **Columns:**

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `user_id` | uuid | NO | — | FK → `users.id` (ON DELETE CASCADE) |
| `listing_id` | uuid | NO | — | FK → `listings.id` (ON DELETE CASCADE) |
| `created_at` | timestamptz | NO | `now()` | When the contact was made |

- **Indexes:**
  - Composite primary key `(user_id, listing_id)`
  - `user_contacted_user_id_idx` — btree on `user_id`
  - `user_contacted_listing_id_idx` — btree on `listing_id`
- **Relationships:**
  - References: `user_id` → `users.id`, `listing_id` → `listings.id`
- **Notable patterns:** Inserted via upsert (`onConflict: "user_id,listing_id"`) — safe to call multiple times. No delete path; record is permanent. Does not track the number of contacts, only that contact occurred.

---

### Marketing

#### `testimonials`
- **Purpose:** Platform-level testimonials displayed on marketing/landing pages. No relational ties to any other table.
- **Row count:** Very low (< 20 records expected)
- **Columns:**

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | uuid | NO | `gen_random_uuid()` | Primary key |
| `mongo_id` | text | YES | — | Migration artifact |
| `text` | text | NO | — | Testimonial quote text |
| `author` | text | NO | — | Attribution name |
| `rating` | numeric(3,2) | NO | — | Star rating 1–5 |
| `created_at` | timestamptz | NO | `now()` | Creation timestamp |
| `updated_at` | timestamptz | NO | `now()` | Auto-managed by trigger |

- **Indexes:** Primary key on `id`
- **Constraints:** `rating CHECK (rating >= 1 AND rating <= 5)`
- **Notable patterns:** Standalone table, no FK constraints. Read via `GET /api/testimonials` (public endpoint, ordered ascending by `created_at`).

---

### Agent Memory Database (SQLite — `.swarm/schema.sql`)

> This database is **not application data**. It is used exclusively by the RuFlo V3 / claude-flow development tooling for AI agent coordination, pattern learning, and session persistence. It lives at `.swarm/` and is separate from the Supabase PostgreSQL instance.

#### `memory_entries`
- **Purpose:** Primary key-value + vector store for agent memory. Supports semantic search via stored embeddings.
- **Key columns:** `id`, `key`, `namespace`, `content`, `type` (semantic/episodic/procedural/working/pattern), `embedding` (JSON array), `access_count`, `status`, `expires_at`

#### `patterns`
- **Purpose:** Learned behavioral patterns with confidence scoring, temporal decay, and versioning.
- **Key columns:** `pattern_type`, `condition`, `action`, `confidence`, `success_count`, `failure_count`, `decay_rate`, `half_life_days`, `version`, `parent_id`

#### `pattern_history`
- **Purpose:** Audit trail of pattern evolution (created/updated/success/failure/decay/merged/split).

#### `trajectories`
- **Purpose:** Learning trajectory sessions linking tasks to their execution outcomes.
- **Key columns:** `status`, `verdict`, `task`, `total_steps`, `total_reward`, `extracted_pattern_id`

#### `trajectory_steps`
- **Purpose:** Individual steps within a trajectory with reward signal.

#### `migration_state`
- **Purpose:** Progress tracking for resumable migrations (V2→V3, pattern, memory types).

#### `sessions`
- **Purpose:** Agent session state persistence across invocations.

#### `vector_indexes`
- **Purpose:** HNSW vector index configuration metadata (dimensions, metric, ef parameters).

#### `metadata`
- **Purpose:** Key-value system metadata (schema version, enabled features).

---

## Views & Materialized Views

None defined. All aggregation is either trigger-maintained (rent/beds/baths/area ranges on `listings`) or computed at query time by the application.

---

## Stored Procedures & Functions

### `sync_listing_aggregates()`
- **Returns:** `trigger`
- **Language:** PL/pgSQL
- **Purpose:** Recomputes all min/max aggregate columns on a `listings` row whenever a `listing_units` row is inserted, updated, or deleted. Determines the target `listing_id` from `NEW.listing_id` (insert/update) or `OLD.listing_id` (delete), then issues a single `UPDATE listings SET min_rent = ..., max_rent = ..., ...` with correlated subqueries.
- **Called by:** `trg_sync_listing_aggregates`

### `set_updated_at()`
- **Returns:** `trigger`
- **Language:** PL/pgSQL
- **Purpose:** Sets `NEW.updated_at = now()` before any UPDATE. Applied to all seven main tables.
- **Called by:** All seven `trg_*_updated_at` triggers

---

## Triggers

| Trigger | Table | Event | Timing | Purpose |
|---------|-------|-------|--------|---------|
| `trg_sync_listing_aggregates` | `listing_units` | INSERT, UPDATE, DELETE | AFTER, per-row | Recomputes min/max rent/beds/baths/area on parent `listings` row |
| `trg_users_updated_at` | `users` | UPDATE | BEFORE, per-row | Sets `updated_at = now()` |
| `trg_listings_updated_at` | `listings` | UPDATE | BEFORE, per-row | Sets `updated_at = now()` |
| `trg_listing_units_updated_at` | `listing_units` | UPDATE | BEFORE, per-row | Sets `updated_at = now()` |
| `trg_reviews_updated_at` | `reviews` | UPDATE | BEFORE, per-row | Sets `updated_at = now()` |
| `trg_dorms_updated_at` | `dorms` | UPDATE | BEFORE, per-row | Sets `updated_at = now()` |
| `trg_dorm_reviews_updated_at` | `dorm_reviews` | UPDATE | BEFORE, per-row | Sets `updated_at = now()` |
| `trg_testimonials_updated_at` | `testimonials` | UPDATE | BEFORE, per-row | Sets `updated_at = now()` |

---

## Cross-Cutting Patterns

### Multi-tenancy
None. This is a single-tenant application — all rows in all tables belong to the same Proximity platform instance.

### Soft Delete
Not implemented. All deletes are hard deletes. Cascades are used to clean up child rows:
- Deleting a `user` cascades to their `reviews`, `user_favorites`, and `user_contacted` rows.
- Deleting a `listing` cascades to `listing_units`, `reviews`, `user_favorites`, and `user_contacted`.
- Deleting a `dorm` cascades to `dorm_reviews`.
- The `listings.landlord_id` FK uses `ON DELETE SET NULL` (not cascade) — a deleted user does not delete their listings.

### Audit Trail
All seven application tables have `created_at` (set at insert, never changed) and `updated_at` (auto-updated via BEFORE UPDATE trigger). No `created_by` / `updated_by` actor columns. No separate audit log table.

### Migration Artifacts
Every migrated table carries a `mongo_id text UNIQUE` column preserving the original MongoDB ObjectId string. These are nullable (rows created post-migration will have `NULL`). Once the MongoDB source is decommissioned, these columns are safe to drop.

### JSONB Usage
`listings.place_walk_minutes` is the only JSONB column in the application schema. It holds a dynamic map from campus place/building names (strings) to walking times in minutes (integers), e.g.:
```json
{"Olin Library": 8, "Danforth University Center": 5, "South 40 Shuttle Stop": 3}
```
The map is computed on listing creation and refreshed by the `POST /api/admin/update-campus-walk-times` admin endpoint using the Mapbox Walking API.

### Array Columns
Multiple `text[]` columns are used instead of junction tables for low-cardinality multi-value fields:
- `listings.images` — ordered array of CDN URLs (order matters for display)
- `listings.utilities_included` — e.g. `{water, trash, internet, electric}`
- `listings.amenities` — canonical snake_case values, e.g. `{dishwasher, in_unit_laundry, gym}`
- `listings.utilities_included`, `listing_units.utilities_included` (during migration transition)
- `dorms.room_types`, `dorms.tags`, `dorm_reviews.tags`

### Enum Conventions
PostgreSQL CHECK constraints are used rather than native `ENUM` types. Values are lowercase with underscores:
- `users.role` — `student`, `landlord`, `super`
- `listings.home_type` — `house`, `apartment`, `condo`, `townhouse`
- `listing_units.lease_availability` — `semester`, `10-month`, `12-month`
- `listing_units.lease_structure` — `individual`, `joint`
- `listing_units.utilities_included` elements — `water`, `sewer`, `trash`, `internet`, `electric`, `gas`, `hotWater`, `yardCare`
- `listings.amenities` elements — canonical snake_case (enforced by `POST /api/admin/migrate-amenities` normalizer)

### Naming Conventions
- All table and column names are `snake_case`.
- Primary keys are always `id uuid`.
- Foreign keys follow `<referenced_table_singular>_id` convention (e.g., `landlord_id`, `listing_id`, `dorm_id`, `user_id`).
- Boolean "status" columns use positive framing (`unavailable`, `sublease_friendly`, `profile_complete`) with boolean defaults.
- Timestamps are `timestamptz` (timezone-aware). The migration-origin `move_in_date` is stored as `text` (no fixed format).

### Image Storage
Images are stored in **Cloudflare R2** (S3-compatible). The database only stores public CDN URLs as strings. Upload is handled via `POST /api/upload` (presigned URL flow) or `PATCH /api/upload` (direct server-side upload). Profile photos are stored under `profiles/<user_id>/` key prefix; listing images under `<listing_id>/` key prefix.

---

## Indexes & Performance Notes

### Existing Indexes
The schema covers the obvious FK lookup and filter columns:
- `listings.landlord_id` — supports "listings by this landlord" queries
- `listings.(latitude, longitude)` — composite; supports bounding-box geo queries (but not radius; PostGIS would be needed for that)
- `listings.(min_rent, max_rent)` — supports rent-range filter common in listing search
- `listing_units.listing_id` — essential; used on every listing detail page load
- `listing_units.bedrooms` and `.rent` — support bedroom/price filters if applied at the unit level

### Missing / Notable Gaps

| Issue | Table / Column | Recommendation |
|-------|---------------|----------------|
| No index on `listings.home_type` uniquely useful | `listings.home_type` | Index exists but selectivity is low (~4 values). May not be used by planner; monitor with `EXPLAIN`. |
| `num_saves` race condition | `listings.num_saves` | Read-modify-write pattern. Consider `UPDATE listings SET num_saves = num_saves + 1` (atomic) instead of fetching then setting. |
| `num_clicks` has no write path | `listings.num_clicks` | No API route increments this counter. Either the route is missing or this column is vestigial. |
| No index on `reviews.legitimacy` | `reviews` | `GET /api/pendingReviews` filters by `legitimacy = false IN (listing_ids)`. An index on `(listing_id, legitimacy)` would help once review volume grows. |
| No index on `users.role` | `users` | Admin routes check `session.user.role = 'super'` in application code, not in DB queries, so no query-level gain today. |
| `dorms.name` lookup | `dorms` | The unique constraint on `name` creates an implicit B-tree index — API name lookups are already covered. |

---

## Open Questions

1. **`distance_to_campus_km` column referenced but not in schema** — `app/api/getUser/route.js` (line 16) serializes `l.distance_to_campus_km` from listing rows. This column does not appear in the schema SQL. It will silently return `undefined`/`null` for all rows. Needs investigation: was it never added, or is it in the live DB but missing from the schema file?

2. **`users.rating` and `users.num_reviews` never written** — These columns exist on the `users` table (presumably for landlord reputation) but no API route found in the codebase writes to them. They may be legacy MongoDB fields that weren't dropped, or the landlord-rating feature was planned but never implemented.

3. **Auth still in MongoDB** — `auth.js` uses `MongoDBAdapter` (NextAuth), meaning session tokens, accounts, and verification tokens live in MongoDB, not Supabase. The `utils/supabase/server.ts` and `utils/supabase/middleware.ts` use `PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY` (a Supabase anon key), which suggests Supabase Auth may also be partially initialized. The relationship between NextAuth sessions and Supabase Auth is unclear — needs clarification to avoid a dual-session bug.

4. **In-progress field migration** — The `DROP COLUMN` step in `docs/migrate-listing-fields.sql` (Step 3) is not yet executed. `listing_units` still carries `furnished`, `utilities_included`, `lease_structure`, `move_in_date`, `sublease_friendly`, `amenities`, `unavailable`, `name`. The `addListing/route.js` writes both tables simultaneously. Once Step 3 runs, the dual-write in `addListing` will need cleanup.

5. **No dorm review moderation** — `dorm_reviews` have no `legitimacy` / approval flow. Anyone can POST anonymously without authentication. Spam or abusive submissions have no removal mechanism exposed via API (would require direct DB intervention or an admin route that doesn't exist yet).

6. **`listing_units.name` pending drop** — The `name` column (e.g., "Studio A") is being dropped per the migration script but is still present in the schema SQL. If it has not been dropped in the live database, dual-write code inserting to `listing_units` without a `name` value should be fine since it's nullable.

7. **No full-text search** — There are no `tsvector` columns or GIN indexes for full-text search on listing descriptions or addresses. All search/filtering appears to be application-side or via exact/range predicates. This may become a bottleneck if listing volume grows significantly.

8. **`testimonials` write path** — No API route for creating or managing testimonials exists in the codebase (`GET /api/testimonials` is read-only). Testimonials must be inserted directly via Supabase dashboard or migration scripts. This may be intentional.
