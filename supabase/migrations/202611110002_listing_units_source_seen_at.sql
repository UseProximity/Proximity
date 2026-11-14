-- Units the website has shown (PR #418 review, Wyatt 2026-11-11).
--
-- The sync withdraws the leases of a unit its website no longer shows. That
-- is only right for units the website showed in the first place: a unit the
-- landlord added by hand, one from another import link, or one the team
-- loaded is not on the website and never was.
--
-- ── listing_units.source_seen_at ────────────────────────────────────────────
-- When a sync or import last matched this unit to the website (or created
-- it from the website). Null for a unit the website has never shown; those
-- are never withdrawn by a sync. The first sync after this ships withdraws
-- nothing, since nothing is stamped yet.
--
-- Idempotent. Apply to BOTH dev and prod.

ALTER TABLE public.listing_units ADD COLUMN IF NOT EXISTS source_seen_at timestamptz;
