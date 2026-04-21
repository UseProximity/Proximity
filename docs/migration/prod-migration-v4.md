# Production Migration: v3 → v4 Schema (Staging → Prod)

**Branch**: `staging`
**Date authored**: 2026-04-20
**Supersedes**: `docs/migration/prod-migration-staging-to-prod.md` (which covered only the address-parsing mini-migration)
**Applies to**: Proximity (Next.js + Supabase)

---

## Summary

The `staging` branch contains a full rewrite of the schema — junction tables for amenities/utilities/walk-times/images/landlords, FK-based lookup tables for roles/home_types/metric_types/interaction_types, split reviews/votes, consolidated interactions, and RLS. All 20+ API routes have been updated to the new schema. This doc migrates prod safely.

**The new code is NOT backward-compatible with the old schema** (it reads `listing_landlords`, `users.role_id`, etc.). Likewise, the old code is NOT compatible with the fully-stripped new schema (it reads `listings.landlord_id`, `users.role`). We bridge this with a three-phase rollout where both schemas coexist during the deploy window.

---

## Three-Phase Rollout

```
Phase 1  (prod DB)   Apply non-destructive migrations — new tables + data copied,
                     legacy columns/tables still present.  Old code still works.

Phase 2  (deploys)   Deploy staging branch to staging env → verify.
                     Deploy to prod → new code runs against mixed schema.

Phase 3  (prod DB)   Apply destructive migrations — drop legacy columns,
                     drop legacy tables.  Only new code is running, so safe.
```

---

## Migration Inventory

| # | File | Safe to run pre-deploy? | Notes |
|---|------|--------------------------|-------|
| 01 | `202604170001_create_lookup_tables` | ✅ | New tables only |
| 02 | `202604170002_seed_lookup_tables` | ✅ | Seeds lookup rows |
| 03 | `202604170003_seed_locations` | ✅ | Seeds locations |
| 04 | `202604170004_migrate_users` | ✅ | Adds `users.role_id`, copies from `users.role`. **Does NOT drop `users.role`.** |
| 05 | `202604170005_create_action_log` | ✅ | New audit table |
| 06 | `202604170006_attach_triggers_phase1` | ✅ | Attaches audit triggers to lookup + users |
| 07 | `202604170007_migrate_listings_structure` | ✅ | Adds `listings.home_type_id`, `primary_landlord_id` |
| 08 | `202604170008_migrate_listing_landlords` | ✅ | Populates junction table from legacy `listings.landlord_id[]` |
| 09 | `202604170009_rename_listing_media` | ⚠️ | **Renames** `listing_media` → `listing_images`. Old code that reads `listing_media` breaks at this point. See note below. |
| 10 | `202604170010_create_listing_amenities` | ✅ | New junction |
| 11 | `202604170011_create_listing_utilities` | ✅ | New junction |
| 12 | `202604170012_create_listing_walk_times` | ✅ | New table |
| 13 | `202604170013_create_unit_leases` | ✅ | New table |
| 14 | `202604170014_migrate_listing_units` | ✅ | Backfills new tables; keeps old columns |
| 15 | `202604170015_migrate_listing_metrics` | ✅ | Adds `metric_type_id` to daily metrics |
| 16 | `202604170016_create_user_listing_interactions` | ✅ | **Fixed**: now migrates `user_favorites` via `it.name='saved'` (was `'favorite'` — nothing matched). |
| 17 | `202604170017_rename_reviews` | ⚠️ | **Renames** `reviews` → `listing_reviews`. See note below. |
| 18 | `202604170018_create_review_votes` | ✅ | New table; populated from legacy `upvotes[]`/`downvotes[]` arrays if present |
| 19 | `202604170019_migrate_dorms` | ✅ | Adds columns, keeps legacy |
| 20 | `202604170020_migrate_dorm_reviews` | ✅ | Backfills tags junction |
| 21 | `202604170021_create_chat_tables` | ✅ | New tables |
| 22 | `202604170022_migrate_matchmaking` | ✅ | Copies `matchmaking_responses` → `matchmaking_preferences` |
| 23 | `202604170023_create_aggregate_functions` | ✅ | **Fixed**: aggregate fn now uses `'saved'`/`'clicks'` (was `'favorite'`/`'view'` — always returned 0). |
| 24 | `202604170024_create_trigger_functions` | ✅ | Function defs only |
| **25** | `202604170025_drop_legacy_columns` | ❌ **DESTRUCTIVE** | **Phase 3 only.** Drops `listings.landlord_id/home_type/amenities/utilities_included/place_walk_minutes/shuttle_walk_minutes/num_reviews/rating/num_saves/num_clicks/images`; drops `users.role/mongo_id/num_reviews/rating`. |
| 26 | `202604170026_attach_triggers_phase2` | ✅ | Trigger attachment only |
| 27 | `202604170027_enable_rls` | ✅ | Enables RLS + policies. Service-role key bypasses RLS, so no impact on API. |
| **28** | `202604170028_cleanup` | ❌ **DESTRUCTIVE** | **Phase 3 only.** Drops `user_favorites`, `user_contacted`, `matchmaking_responses`, `action_logs`. |
| 29 | `20260418001849_drop_duplicate_fk_constraints` | ✅ | Safe — drops redundant FKs |
| 30 | `20260418211133_add_sublease_to_unit_leases` | ✅ | Adds column |
| 31 | `202604200001_fix_aggregate_interaction_and_metric_names` | ✅ | CREATE OR REPLACE on `fn_get_listing_aggregates` — idempotent |

### About the two `⚠️ rename` migrations (0009 `listing_media` → `listing_images`, 0017 `reviews` → `listing_reviews`)

These rename existing tables. After they run, the old code will 500 on any route that queries the old name. If prod has any active old-code references to `reviews` or `listing_media` (it does — the pre-v4 code did), you have a choice:

- **Option A (preferred)** — also deploy the new code in Phase 2 immediately after Phase 1 finishes, keeping the maintenance window short (seconds–minutes).
- **Option B** — put the site in maintenance mode during Phase 1 so no old-code reads happen while the rename is in flight.

Since phases 1→2 can be done back-to-back, Option A is fine for a team this size.

---

## Pre-flight (one-time, before Phase 1)

### 0.1 Confirm target project
Verify `SUPABASE_URL` / Vercel env vars point to the production project. The Supabase MCP connection in this repo must be scoped to prod (rerun `claude mcp` auth if unsure).

### 0.2 Confirm prod is on the v3 (pre-migration) schema
```sql
-- Should all return TRUE on prod:
SELECT EXISTS (SELECT 1 FROM information_schema.columns
  WHERE table_name='users' AND column_name='role');
SELECT EXISTS (SELECT 1 FROM information_schema.columns
  WHERE table_name='listings' AND column_name='landlord_id');
SELECT EXISTS (SELECT 1 FROM information_schema.tables
  WHERE table_name='reviews');
-- If any returns FALSE, prod has already been partially migrated — stop and investigate.
```

### 0.3 Full DB backup
```bash
pg_dump "$SUPABASE_PROD_DB_URL" \
  --no-acl --no-owner \
  -F c \
  -f "backup_pre_v4_$(date +%Y%m%d_%H%M%S).dump"
```
Store the dump somewhere durable (S3 or local drive). **Do not skip this.**

### 0.4 Sanity check row counts (record for later comparison)
```sql
SELECT 'users' AS t, COUNT(*) FROM users
UNION ALL SELECT 'listings', COUNT(*) FROM listings
UNION ALL SELECT 'reviews', COUNT(*) FROM reviews
UNION ALL SELECT 'user_favorites', COUNT(*) FROM user_favorites
UNION ALL SELECT 'user_contacted', COUNT(*) FROM user_contacted
UNION ALL SELECT 'matchmaking_responses', COUNT(*) FROM matchmaking_responses
UNION ALL SELECT 'listing_units', COUNT(*) FROM listing_units
UNION ALL SELECT 'listing_media', COUNT(*) FROM listing_media
UNION ALL SELECT 'dorms', COUNT(*) FROM dorms
UNION ALL SELECT 'dorm_reviews', COUNT(*) FROM dorm_reviews;
```
Save the output — you'll compare against post-migration row counts.

---

## Phase 1 — Apply non-destructive migrations

Target: **production Supabase project**.

Apply these files in order, using `mcp__supabase__apply_migration` (or `supabase db push` with files 0025 and 0028 temporarily moved to `_pending/`):

```
202604170001_create_lookup_tables
202604170002_seed_lookup_tables
202604170003_seed_locations
202604170004_migrate_users
202604170005_create_action_log
202604170006_attach_triggers_phase1
202604170007_migrate_listings_structure
202604170008_migrate_listing_landlords
202604170009_rename_listing_media        ← rename: begin maintenance window here if using Option B
202604170010_create_listing_amenities
202604170011_create_listing_utilities
202604170012_create_listing_walk_times
202604170013_create_unit_leases
202604170014_migrate_listing_units
202604170015_migrate_listing_metrics
202604170016_create_user_listing_interactions
202604170017_rename_reviews              ← rename
202604170018_create_review_votes
202604170019_migrate_dorms
202604170020_migrate_dorm_reviews
202604170021_create_chat_tables
202604170022_migrate_matchmaking
202604170023_create_aggregate_functions
202604170024_create_trigger_functions
202604170026_attach_triggers_phase2      ← SKIP 25 for now
202604170027_enable_rls
20260418001849_drop_duplicate_fk_constraints
20260418211133_add_sublease_to_unit_leases
202604200001_fix_aggregate_interaction_and_metric_names
```

**Do NOT run 0025 or 0028 yet.**

### 1.1 Using the Supabase CLI (recommended)
Move 0025 and 0028 to `supabase/migrations/_pending/` temporarily so `db push` skips them:
```bash
mkdir -p supabase/migrations/_pending
mv supabase/migrations/202604170025_drop_legacy_columns.sql   supabase/migrations/_pending/
mv supabase/migrations/202604170028_cleanup.sql               supabase/migrations/_pending/
supabase link --project-ref <PROD_PROJECT_REF>
supabase db push
# (move them back after Phase 3)
```

### 1.2 Using the MCP apply_migration tool
For each file listed above (in order), run `mcp__supabase__apply_migration` with `name` = the migration version (e.g. `202604170001_create_lookup_tables`) and `query` = the file contents. This also records the migration in `supabase_migrations.schema_migrations` so later `db push` won't re-apply.

### 1.3 Verify Phase 1 completed cleanly
```sql
-- New tables exist
SELECT COUNT(*) FROM listing_landlords;
SELECT COUNT(*) FROM listing_amenities;
SELECT COUNT(*) FROM listing_utilities;
SELECT COUNT(*) FROM listing_walk_times;
SELECT COUNT(*) FROM listing_images;    -- renamed from listing_media
SELECT COUNT(*) FROM unit_leases;
SELECT COUNT(*) FROM listing_reviews;   -- renamed from reviews
SELECT COUNT(*) FROM user_listing_interactions;
SELECT COUNT(*) FROM matchmaking_preferences;

-- Legacy still exists (used as fallback by old code during deploy window)
SELECT COUNT(*) FROM user_favorites;
SELECT COUNT(*) FROM user_contacted;
SELECT COUNT(*) FROM matchmaking_responses;

-- New columns populated
SELECT COUNT(*) FROM users WHERE role_id IS NOT NULL;              -- should equal total users
SELECT COUNT(*) FROM listings WHERE primary_landlord_id IS NOT NULL OR NOT EXISTS
  (SELECT 1 FROM listing_landlords WHERE listing_id = listings.id);

-- Aggregate function works on a real listing
SELECT * FROM fn_get_listing_aggregates(ARRAY(SELECT id FROM listings LIMIT 5));

-- Interaction counts migrated correctly (the bug fixed in 0016)
SELECT it.name, COUNT(*)
FROM user_listing_interactions uli JOIN interaction_types it ON it.id = uli.interaction_type_id
GROUP BY it.name;
-- Expect: 'saved' count == old user_favorites count; 'contacted' count == old user_contacted count
```

If anything looks wrong, restore from the Pre-flight backup **before proceeding**.

---

## Phase 2 — Deploy new code

### 2.1 Push staging branch to the staging environment
```bash
git push origin staging
# Vercel auto-deploys staging branch → staging.useproximity.org (or equivalent)
```
Staging should be wired to either the dev DB (already on v4) or the prod DB (now partially on v4 after Phase 1). Either works — the new code handles both.

### 2.2 Smoke-test staging
Hit each of these manually:
- [ ] `/` loads; sign in with Google works
- [ ] `/browse` — listings grid renders with correct unit prices (not "TBD"), amenities, images
- [ ] Open a listing modal — amenities, walk times, reviews, unit cards all render
- [ ] Favorite a listing (heart icon) — no 500; listing appears on dashboard favorites
- [ ] Submit a review — no 500; appears pending until an admin approves
- [ ] Contact-landlord form — no 500; email fires (if SMTP configured for staging)
- [ ] `/matchmaking` — submit form with `$800-$1,000` budget → no 500; record in `matchmaking_preferences`
- [ ] `/CampusHub` — dorm cards show ratings + tags
- [ ] `/dashboard/landlord` (login as a landlord account) — metrics page renders; clicks/saves/contacts counts visible
- [ ] `/dashboard/admin` (super account) — open `listings` tab, save a change, confirm it persists
- [ ] `/dashboard/admin` — "View As" a student and a landlord works
- [ ] `/dashboard/admin` — FK columns display human-readable labels (role name, home type, etc.)

Only proceed once staging is fully green.

### 2.3 Deploy to prod
```bash
git checkout main
git merge staging
git push origin main
# Vercel auto-deploys main → useproximity.org
```

### 2.4 Prod smoke test (run the same checklist against useproximity.org)
After this point, all prod traffic is running the new code against the prod DB that still has legacy columns/tables alongside the new ones. This is the designed safe state.

---

## Phase 3 — Drop legacy columns & tables

Only proceed once prod has been stable on the new code for at least 24 hours (confirm no 500s in Vercel logs referencing the soon-to-be-dropped columns).

### 3.1 Apply the two destructive migrations
```bash
# Move them back into the migrations dir
mv supabase/migrations/_pending/202604170025_drop_legacy_columns.sql supabase/migrations/
mv supabase/migrations/_pending/202604170028_cleanup.sql             supabase/migrations/
supabase db push
```
Or via MCP:
- `mcp__supabase__apply_migration` name=`202604170025_drop_legacy_columns` query=<file body>
- `mcp__supabase__apply_migration` name=`202604170028_cleanup` query=<file body>

### 3.2 Verify
```sql
-- Dropped columns are gone
SELECT column_name FROM information_schema.columns
  WHERE table_name IN ('users','listings')
    AND column_name IN ('role','landlord_id','home_type','amenities','utilities_included',
                        'place_walk_minutes','shuttle_walk_minutes','num_reviews','rating',
                        'num_saves','num_clicks','images','mongo_id');
-- Expect 0 rows for users; listings.mongo_id may still exist (kept for audit)

-- Dropped tables are gone
SELECT table_name FROM information_schema.tables
  WHERE table_schema='public'
    AND table_name IN ('user_favorites','user_contacted','matchmaking_responses','action_logs');
-- Expect 0 rows
```

### 3.3 Final prod smoke test
Re-run the Phase 2.4 checklist. Any column-not-found or table-not-found error here means a code path was missed in the audit — roll back and patch (see below).

---

## Rollback Procedures

### Code-only rollback (safe at any phase)
```bash
git revert HEAD     # or redeploy the previous Vercel snapshot
```
Old code on a partially-migrated prod DB (phases 1 or 2 only) will work because legacy columns/tables are still present.

### Phase 3 rollback (columns/tables already dropped)
You cannot restore dropped columns with data intact — you must use the Pre-flight backup:
```bash
pg_restore "$SUPABASE_PROD_DB_URL" \
  -F c --no-acl --no-owner --clean \
  backup_pre_v4_YYYYMMDD_HHMMSS.dump
```
This nukes all post-backup writes (new users, listings, reviews, etc. made during the migration window). Only use if code rollback + re-deploying old schema is infeasible.

### Per-migration rollback
Each migration file is reversible with targeted SQL. If a specific Phase 1 migration produces bad data, write a one-off reverse script rather than rolling back everything. Examples:
- 0016 (interactions) — `TRUNCATE user_listing_interactions; INSERT FROM user_favorites/user_contacted again.`
- 0008 (landlords) — `TRUNCATE listing_landlords; INSERT FROM listings.landlord_id again.`

---

## Notes for the Claude Code session running this

- Use `mcp__supabase__apply_migration` for each SQL step — it records the migration in `supabase_migrations.schema_migrations` so `supabase db push` won't attempt to re-run.
- Always `execute_sql` the verification queries after every migration — don't chain without checking.
- If you see FK violation errors during 0008 (`migrate_listing_landlords`), investigate — prod may have orphaned `landlord_id` entries referencing deleted users. Clean those up first.
- Prod has more data than dev — some migrations that ran in <1s on dev may take minutes on prod. Don't cancel; watch for actual errors.
- The backup file from step 0.3 is the only true safety net. Verify it exists and `pg_restore --list` can read it before starting Phase 1.

---

## Known caveats (not blockers)

1. **`mongo_id` columns remain** on `listings`, `dorms`, `dorm_reviews`, `listing_reviews`, `testimonials`. They are legacy reference IDs, nullable, and unused by API code. Safe to drop in a future migration once we're confident no external system references them.
2. **Legacy aggregate columns remain** on `listings` (`min_rent`, `max_rent`, `lease_availability[]`, `lease_structure`, `move_in_date`, `sublease_friendly`, etc.). Some API code still reads them as fallback. A future migration can replace these reads with joins to `listing_units`/`unit_leases` and then drop.
3. **`amenities` / `utilities` dictionary tables** (21 and 9 rows) are unreferenced after the move to boolean columns on `listing_amenities`/`listing_utilities`. Candidates for future drop.

None of these block the v4 migration — they're just tech debt flagged for later.
