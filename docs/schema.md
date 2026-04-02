# Proximity – Supabase Database Schema

> Pulled live from the PostgREST OpenAPI introspection endpoint (dev + prod).  
> Both environments share an identical schema. Column order differences are cosmetic.  
> Last updated: 2026-04-02

---

## Tables

- [users](#users)
- [listings](#listings)
- [listing\_units](#listing_units)
- [listing\_metrics\_daily](#listing_metrics_daily)
- [reviews](#reviews)
- [dorms](#dorms)
- [dorm\_reviews](#dorm_reviews)
- [testimonials](#testimonials)
- [user\_favorites](#user_favorites)
- [user\_contacted](#user_contacted)

---

## users

Primary user accounts (students, landlords, super-admins).

| Column | Type | Required | Notes |
|--------|------|----------|-------|
| `id` | uuid | YES | PK, `gen_random_uuid()` |
| `mongo_id` | text | no | Legacy MongoDB ObjectId (migration artifact) |
| `name` | text | no | Display name |
| `email` | text | no | Unique |
| `image` | text | no | Profile photo URL |
| `role` | text | YES | `'student'` \| `'landlord'` \| `'super'`, default `'student'` |
| `birthday` | timestamptz | no | |
| `description` | text | YES | default `''` |
| `gender` | text | YES | default `'unspecified'` |
| `num_reviews` | integer | YES | default `0` |
| `phone` | text | YES | default `'N/A'` |
| `profile_complete` | boolean | YES | default `false` |
| `rating` | numeric(3,2) | YES | 0–5, default `0` |
| `referral_source` | text | YES | default `''` |
| `graduation_year` | integer | no | |
| `graduation_month` | integer | no | |
| `created_at` | timestamptz | YES | default `now()` |
| `updated_at` | timestamptz | YES | auto-updated via trigger |

---

## listings

Off-campus rental listings. Per-unit details live in `listing_units`; min/max aggregate columns are maintained automatically by the `sync_listing_aggregates` trigger.

| Column | Type | Required | Notes |
|--------|------|----------|-------|
| `id` | uuid | YES | PK |
| `mongo_id` | text | no | Legacy MongoDB ObjectId |
| `landlord_id` | uuid | no | FK → `users.id`, `ON DELETE SET NULL` |
| `title` | text | no | |
| `address` | text | YES | |
| `latitude` | numeric(10,7) | YES | |
| `longitude` | numeric(11,7) | YES | |
| `description` | text | YES | |
| `home_type` | text | YES | `'house'` \| `'apartment'` \| `'condo'` \| `'townhouse'`, default `'apartment'` |
| `lease_type` | text | YES | e.g. `'standard'` |
| `lease_structure` | text | no | `'individual'` \| `'joint'` |
| `move_in_date` | text | no | |
| `furnished` | boolean | YES | default `false` |
| `utilities_included` | text[] | YES | default `'{}'` |
| `sublease_friendly` | boolean | YES | default `false` |
| `amenities` | text[] | YES | default `'{}'` |
| `images` | text[] | YES | Array of storage URLs, default `'{}'` |
| `place_walk_minutes` | jsonb | YES | `{ "Olin Library": 8, … }`, default `'{}'` |
| `shuttle_walk_minutes` | integer | no | Walk minutes to nearest shuttle stop |
| `contact_email` | text | no | For listings without a platform account |
| `contact_phone` | text | no | |
| `contact_name` | text | no | |
| `unavailable` | boolean | YES | default `false` |
| `rating` | numeric(3,2) | YES | Avg of approved reviews, 0–5 |
| `num_reviews` | integer | YES | Count of approved reviews |
| `num_clicks` | integer | YES | default `0` |
| `num_saves` | integer | YES | default `0` |
| `min_rent` | numeric | no | Auto-computed from `listing_units` |
| `max_rent` | numeric | no | Auto-computed from `listing_units` |
| `min_bedrooms` | integer | no | Auto-computed from `listing_units` |
| `max_bedrooms` | integer | no | Auto-computed from `listing_units` |
| `min_bathrooms` | numeric | no | Auto-computed from `listing_units` |
| `max_bathrooms` | numeric | no | Auto-computed from `listing_units` |
| `min_area` | numeric | no | Auto-computed from `listing_units` |
| `max_area` | numeric | no | Auto-computed from `listing_units` |
| `created_at` | timestamptz | YES | default `now()` |
| `updated_at` | timestamptz | YES | auto-updated via trigger |

---

## listing_units

One row per rentable unit configuration within a listing. Inserts/updates/deletes here fire the `sync_listing_aggregates` trigger to keep the parent `listings` min/max columns in sync.

| Column | Type | Required | Notes |
|--------|------|----------|-------|
| `id` | uuid | YES | PK |
| `listing_id` | uuid | YES | FK → `listings.id`, `ON DELETE CASCADE` |
| `bedrooms` | integer | YES | |
| `bathrooms` | numeric | YES | |
| `rent` | numeric | no | Monthly rent in USD |
| `area` | numeric | no | Square feet |
| `lease_availability` | text | no | `'semester'` \| `'10-month'` \| `'12-month'` |
| `created_at` | timestamptz | YES | default `now()` |
| `updated_at` | timestamptz | YES | auto-updated via trigger |

---

## listing_metrics_daily

Daily aggregated engagement metrics per listing, used by the landlord dashboard charts.

| Column | Type | Required | Notes |
|--------|------|----------|-------|
| `id` | uuid | YES | PK |
| `listing_id` | uuid | YES | FK → `listings.id` |
| `landlord_id` | uuid | no | FK → `users.id` (denormalized for fast filtering) |
| `metric_type` | text | YES | `'clicks'` \| `'saves'` \| `'contacts'` |
| `recorded_date` | date | YES | |
| `count` | integer | YES | |

> Populated by the `increment_listing_metric(p_listing_id, p_landlord_id, p_metric_type, p_date)` RPC function.

---

## reviews

Student reviews of off-campus listings. Unapproved reviews have `legitimacy = false` and are only visible to the listing's landlord for moderation.

| Column | Type | Required | Notes |
|--------|------|----------|-------|
| `id` | uuid | YES | PK |
| `mongo_id` | text | no | Legacy MongoDB ObjectId |
| `user_id` | uuid | YES | FK → `users.id`, `ON DELETE CASCADE` |
| `listing_id` | uuid | YES | FK → `listings.id`, `ON DELETE CASCADE` |
| `rating` | numeric(3,2) | YES | 1–5 |
| `comment` | text | YES | |
| `legitimacy` | boolean | YES | `false` = pending, `true` = approved |
| `communication_rating` | integer | no | 1–5 |
| `location_rating` | integer | no | 1–5 |
| `value_rating` | integer | no | 1–5 |
| `created_at` | timestamptz | YES | default `now()` |
| `updated_at` | timestamptz | YES | auto-updated via trigger |

**Unique constraint:** `(user_id, listing_id)` — one review per student per listing.

---

## dorms

WashU on-campus dormitories.

| Column | Type | Required | Notes |
|--------|------|----------|-------|
| `id` | uuid | YES | PK |
| `mongo_id` | text | no | Legacy MongoDB ObjectId |
| `name` | text | YES | Unique |
| `room_types` | text[] | YES | default `'{}'` |
| `description` | text | YES | default `''` |
| `tags` | text[] | YES | default `'{}'` |
| `image` | text | no | Cover photo URL |
| `created_at` | timestamptz | YES | default `now()` |
| `updated_at` | timestamptz | YES | auto-updated via trigger |

---

## dorm_reviews

Anonymous reviews of on-campus dorms (no user account required).

| Column | Type | Required | Notes |
|--------|------|----------|-------|
| `id` | uuid | YES | PK |
| `mongo_id` | text | no | Legacy MongoDB ObjectId |
| `dorm_id` | uuid | YES | FK → `dorms.id`, `ON DELETE CASCADE` |
| `reviewer_name` | text | YES | Free-text name (not linked to a user account) |
| `class_year` | integer | YES | e.g. `2026` |
| `rating` | numeric(3,2) | YES | 1–5 |
| `dorm_type` | text | YES | Room type label, default `''` |
| `tags` | text[] | YES | default `'{}'` |
| `content` | text | YES | Review body (min 10 chars enforced in API) |
| `created_at` | timestamptz | YES | default `now()` |
| `updated_at` | timestamptz | YES | auto-updated via trigger |

---

## testimonials

Homepage testimonials. Standalone — no foreign keys.

| Column | Type | Required | Notes |
|--------|------|----------|-------|
| `id` | uuid | YES | PK |
| `mongo_id` | text | no | Legacy MongoDB ObjectId |
| `text` | text | YES | Testimonial body |
| `author` | text | YES | |
| `rating` | numeric(3,2) | YES | 1–5 |
| `created_at` | timestamptz | YES | default `now()` |
| `updated_at` | timestamptz | YES | auto-updated via trigger |

---

## user_favorites

Many-to-many join between users and listings (saved/favorited listings).

| Column | Type | Required | Notes |
|--------|------|----------|-------|
| `user_id` | uuid | YES | PK, FK → `users.id`, `ON DELETE CASCADE` |
| `listing_id` | uuid | YES | PK, FK → `listings.id`, `ON DELETE CASCADE` |
| `created_at` | timestamptz | YES | default `now()` |

**Primary key:** `(user_id, listing_id)`

---

## user_contacted

Many-to-many join tracking which listings a user has contacted a landlord about.

| Column | Type | Required | Notes |
|--------|------|----------|-------|
| `user_id` | uuid | YES | PK, FK → `users.id`, `ON DELETE CASCADE` |
| `listing_id` | uuid | YES | PK, FK → `listings.id`, `ON DELETE CASCADE` |
| `created_at` | timestamptz | YES | default `now()` |

**Primary key:** `(user_id, listing_id)`

---

## Triggers & Functions

| Name | Table | Event | Description |
|------|-------|-------|-------------|
| `trg_sync_listing_aggregates` | `listing_units` | AFTER INSERT/UPDATE/DELETE | Recomputes `min_rent`, `max_rent`, `min_bedrooms`, `max_bedrooms`, `min_bathrooms`, `max_bathrooms`, `min_area`, `max_area` on the parent `listings` row |
| `trg_users_updated_at` | `users` | BEFORE UPDATE | Sets `updated_at = now()` |
| `trg_listings_updated_at` | `listings` | BEFORE UPDATE | Sets `updated_at = now()` |
| `trg_listing_units_updated_at` | `listing_units` | BEFORE UPDATE | Sets `updated_at = now()` |
| `trg_reviews_updated_at` | `reviews` | BEFORE UPDATE | Sets `updated_at = now()` |
| `trg_dorms_updated_at` | `dorms` | BEFORE UPDATE | Sets `updated_at = now()` |
| `trg_dorm_reviews_updated_at` | `dorm_reviews` | BEFORE UPDATE | Sets `updated_at = now()` |
| `trg_testimonials_updated_at` | `testimonials` | BEFORE UPDATE | Sets `updated_at = now()` |
| `increment_listing_metric` | — | RPC | Upserts a daily count row in `listing_metrics_daily` for a given listing + metric type + date |

---

## Indexes

| Table | Columns |
|-------|---------|
| `listings` | `landlord_id` |
| `listings` | `home_type` |
| `listings` | `lease_type` |
| `listings` | `(latitude, longitude)` |
| `listings` | `(min_rent, max_rent)` |
| `listings` | `unavailable` |
| `listing_units` | `listing_id` |
| `listing_units` | `bedrooms` |
| `listing_units` | `rent` |
| `reviews` | `listing_id` |
| `reviews` | `user_id` |
| `dorm_reviews` | `dorm_id` |
| `user_favorites` | `user_id` |
| `user_favorites` | `listing_id` |
| `user_contacted` | `user_id` |
| `user_contacted` | `listing_id` |

---

## Dev vs Prod Differences

Both environments have identical schemas as of 2026-04-02. The only observable difference is column ordering within the `listings` table (PostgreSQL treats this as cosmetic). No structural differences were found.

- **Dev:** `https://ngytjsckypjxddzpaekt.supabase.co`
- **Prod:** `https://imawamfhakroxtugmlne.supabase.co`
