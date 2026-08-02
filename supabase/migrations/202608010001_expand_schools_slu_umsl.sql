-- Expansion beyond WashU: add Saint Louis University and University of Missouri–St. Louis
-- to the schools reference table, and start actually using the school_id columns that have
-- existed (unpopulated) since the schools table was created.
--
-- Every listing in the catalog today was sourced for the WashU market, so all existing rows
-- are backfilled to WashU. New listings created from a student review are stamped with the
-- reviewer's school by the app (see /api/reviewReferral).
--
-- Idempotent: safe to re-run. Applied to BOTH dev and prod.

-- ── 1. Seed the two new schools ────────────────────────────────────────────────
insert into public.schools (name, short_name, city, state, latitude, longitude, website)
select 'Saint Louis University', 'SLU', 'St. Louis', 'MO', 38.6362, -90.2340, 'https://www.slu.edu'
where not exists (select 1 from public.schools where short_name = 'SLU');

insert into public.schools (name, short_name, city, state, latitude, longitude, website)
select 'University of Missouri–St. Louis', 'UMSL', 'St. Louis', 'MO', 38.7096, -90.3093, 'https://www.umsl.edu'
where not exists (select 1 from public.schools where short_name = 'UMSL');

-- ── 2. Enforce one row per school ──────────────────────────────────────────────
-- short_name is what the app keys off of (see apps/web/src/lib/schools.js), so it must be
-- unique or the domain→school lookup becomes ambiguous.
create unique index if not exists schools_short_name_key
  on public.schools (short_name)
  where short_name is not null;

-- ── 3. Backfill every existing listing to WashU ────────────────────────────────
-- Includes soft-deleted rows so the column is uniformly populated going forward.
update public.listings
set school_id = (select id from public.schools where short_name = 'WashU')
where school_id is null;
