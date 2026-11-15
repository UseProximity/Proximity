-- What the website sync learns about each listing (Wyatt, 2026-11-11).
--
-- The sync decides every change on its own (lib/sourceImport/syncPolicy.js),
-- and the landlord's own data always wins. It cannot ask the landlord what
-- they meant, so it learns it by comparing their edits with what it read:
--
-- ── listing_sync_learnings ──────────────────────────────────────────────────
--   kind 'synced'      the values the sync last wrote to one lease or unit,
--                      from the website (source_key lease:<id> or unit:<id>).
--                      A listing that now says something else was edited by
--                      the landlord: that field is left alone until the
--                      website's own value changes again.
--   kind 'unit_alias'  the website's name for one of the landlord's units
--                      (source_key the site's unit key, e.g. n:candy): the
--                      site's "Candy" keeps updating the landlord's
--                      "2 Bedroom" whatever its size or layout says.
--   kind 'rent_basis'  how the landlord states the website's rents
--                      (source_key '*'): value { basis: 'per_person' } when
--                      they turned the site's whole-apartment rents into
--                      per-person ones.
--
-- Rows go with their listing, unit or lease. Server-side only (service role).
-- Idempotent. Apply to BOTH dev and prod.

CREATE TABLE IF NOT EXISTS public.listing_sync_learnings (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id    uuid NOT NULL REFERENCES public.listings(id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN ('synced', 'unit_alias', 'rent_basis')),
  source_key    text NOT NULL CHECK (length(source_key) BETWEEN 1 AND 200),
  unit_id       uuid REFERENCES public.listing_units(id) ON DELETE CASCADE,
  lease_id      uuid REFERENCES public.unit_leases(id) ON DELETE CASCADE,
  value         jsonb NOT NULL DEFAULT '{}'::jsonb,
  learned_from  text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (listing_id, kind, source_key)
);

CREATE INDEX IF NOT EXISTS listing_sync_learnings_listing_idx ON public.listing_sync_learnings (listing_id);

ALTER TABLE public.listing_sync_learnings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.listing_sync_learnings FROM anon, authenticated;
