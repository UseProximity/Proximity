# Production Migration: Staging → Prod (ADDRESS FIELDS ONLY — SUPERSEDED)

> ⚠️ **This doc is superseded by [`prod-migration-v4.md`](./prod-migration-v4.md).**
> It covers only the small address-field mini-migration done on dev in mid-April.
> The full v4 schema migration (junction tables, RLS, drop legacy) is in the newer doc.
> Keep this file for historical reference only.

**Branch**: `staging`
**Date authored**: 2026-04-17
**Applies to**: Proximity (Next.js + Supabase)

Feed this file to a Claude Code session and say:
> "Follow the prod migration plan in docs/migration/prod-migration-staging-to-prod.md step by step."

---

## Context

This migration covers a batch of bug fixes and schema improvements made on the dev/staging
database. There are two categories of change:

1. **Code fixes** — already committed on the `staging` branch; just need to be deployed.
2. **Database changes** — two SQL scripts that populate new columns and clean up the address field.

---

## What Changed

### Code (already in git on `staging`)

| File | Change |
|---|---|
| `app/api/favorites/route.js` | interaction_type lookup: `"favorite"` → `"saved"` |
| `app/api/favorites/[listingId]/route.js` | same fix |
| `app/api/getUser/route.js` | same fix |
| `app/api/admin/viewUser/route.js` | same fix |
| `app/api/matchmaking/route.js` | budget string parser — strips `$`/`,`, handles `"$800-$1,000"` ranges before inserting into `numeric` columns |
| `app/api/dormReviews/route.js` | tags fetched via junction table: `dorm_review_tags(tags(name))` |
| `app/CampusHub/page.js` | tag normalization from junction data; building rating + star icon on cards; rating filter null-guard |
| `components/show-listings/AvailableListings.js` | fetches full listing detail from `/api/listing/[id]` on panel open (fixes TBD prices and missing review IDs) |
| `app/dashboard/view-as/[userId]/page.js` | role resolved via `roles!role_id(name)` join (dropped `role` column was causing redirect loop) |
| `app/dashboard/admin/page.js` | comprehensive FK label resolution for all FK columns; chained FKs (e.g. `unit_id → listing_units → listings.address`) |

### Database

| Script | Description |
|---|---|
| Script 1 | Populate `city`, `state`, `zipcode` columns on `listings` by parsing the `address` string |
| Script 2 | Trim `address` column to street-only (strip city/state/zip suffix) |

> ⚠️ Script 2 is **destructive** — the original full address string is gone after it runs.
> The safety column added in the pre-flight step is your in-DB fallback.

---

## Step-by-Step Instructions

### Step 0 — Confirm you are targeting production

Before doing anything, verify the Supabase project URL resolves to the production project,
not dev/staging. Check `.env.production` or your Vercel environment variables.

---

### Step 1 — Create a hard backup

Run this from a terminal with access to the production DB connection string:

```bash
pg_dump "$SUPABASE_DB_URL" \
  --no-acl --no-owner \
  -F c \
  -f "backup_pre_migration_$(date +%Y%m%d_%H%M%S).dump"
```

Store the `.dump` file somewhere durable (S3 bucket, local drive) before proceeding.
**Do not skip this step.**

---

### Step 2 — Add the address safety column

Run in the **production** Supabase SQL editor (or via MCP `execute_sql`):

```sql
ALTER TABLE listings ADD COLUMN IF NOT EXISTS address_full TEXT;
UPDATE listings SET address_full = address WHERE address IS NOT NULL;
```

Verify:

```sql
SELECT COUNT(*) FROM listings WHERE address_full IS NOT NULL;
-- should equal the total number of listings with an address
```

---

### Step 3 — Populate city / state / zipcode (Script 1)

```sql
UPDATE listings l
SET
  city    = sub.city,
  state   = sub.state,
  zipcode = sub.zipcode
FROM (
  SELECT
    id,
    trim(parts[array_length(parts, 1) - 1]) AS city,
    trim(regexp_replace(
      trim(parts[array_length(parts, 1)]),
      '\s*\d{5}(?:-\d{4})?\s*$', ''
    )) AS state,
    (regexp_match(address, '(\d{5})(?:-\d{4})?'))[1] AS zipcode
  FROM (
    SELECT
      id,
      address,
      string_to_array(
        regexp_replace(address, ',\s*(United States|USA)\s*$', '', 'i'),
        ','
      ) AS parts
    FROM listings
    WHERE address IS NOT NULL
  ) normalized
  WHERE array_length(parts, 1) >= 3
) sub
WHERE l.id = sub.id;
```

Verify a sample:

```sql
SELECT address, city, state, zipcode FROM listings WHERE city IS NOT NULL LIMIT 10;
```

Expected: city = `"St. Louis"`, state = `"MO"` or `"Missouri"`, zipcode = 5-digit string.

---

### Step 4 — Trim address to street-only (Script 2)

Only run this **after** Script 1 looks correct.

```sql
UPDATE listings
SET address = trim(split_part(address, ',', 1))
WHERE city IS NOT NULL;
```

Verify:

```sql
SELECT address, city, state, zipcode FROM listings LIMIT 10;
-- address should be e.g. "5608 Pershing Avenue", not the full string
```

---

### Step 5 — Deploy the code

Merge `staging` → `main` (or deploy `staging` directly, per your workflow):

```bash
git checkout main
git merge staging
git push origin main
```

Then trigger a Vercel deployment (or it auto-deploys on push to `main`).

---

### Step 6 — Smoke test production

Hit each of these manually after deploy:

- [ ] Browse listings → unit prices show actual rent (not "TBD")
- [ ] Favorite a listing → no 500 error
- [ ] Submit matchmaking form with a budget range like `$800-$1,000` → no 500
- [ ] CampusHub → tags visible on cards, rating shown with star icon, rating filter works
- [ ] Admin panel → "View As" for a student and a landlord each shows the correct dashboard
- [ ] Admin panel → FK columns (e.g. `user_id`, `unit_id`, `role_id`) show human-readable labels

---

### Step 7 — Drop the safety column (after 24–48 hrs)

Once production is confirmed stable:

```sql
ALTER TABLE listings DROP COLUMN address_full;
```

---

## Rollback Procedures

### Code rollback

If a code bug is found, revert the deploy without touching the DB:

```bash
git revert HEAD   # or redeploy the previous Vercel snapshot
```

### Database rollback — Scripts only (no backup restore needed)

**If Script 1 produced bad city/state/zip values:**
```sql
UPDATE listings SET city = NULL, state = NULL, zipcode = NULL;
-- then re-run the corrected Script 1
```

**If Script 2 mangled addresses (safety column still intact):**
```sql
UPDATE listings
SET address = address_full
WHERE address_full IS NOT NULL;
```

### Full database rollback (last resort)

Restore from the `.dump` file created in Step 1:

```bash
pg_restore "$SUPABASE_DB_URL" \
  -F c \
  --no-acl --no-owner \
  --clean \
  backup_pre_migration_YYYYMMDD_HHMMSS.dump
```

> ⚠️ This overwrites **all** production data with the backup snapshot.
> Only use this if partial rollbacks above are insufficient.

---

## Notes for the Claude Code session running this

- Use `mcp__supabase__execute_sql` for all SQL steps — do not use the Supabase dashboard manually.
- Run Steps 2–4 sequentially, verifying each before proceeding.
- Steps 1 (backup) and 2 (safety column) must happen before any UPDATE runs.
- The code deploy (Step 5) is safe to do before or after the DB scripts — the updated code is backward-compatible with the old DB state.
