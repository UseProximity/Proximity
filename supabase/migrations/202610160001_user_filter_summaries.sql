-- Browse filter summary for suggested listings (Wyatt, 2026-10-16).
--
-- One row per user holding the browse filters they last SAVED (the Done /
-- Apply Filters buttons), overwritten each time. It is the weakest of the three
-- signals behind "Suggested for you" (matchmaking answers, then saved and
-- contacted listings, then this), and it only ever holds the latest set: no
-- history is kept, so there is nothing to retain beyond the account itself.
--
-- `filters` is the browse DEFAULT_FILTERS shape (lib/listings/filterListings.js)
-- with the per-session keys (savedOnly) stripped server-side before the write.
--
-- Deleted by the purge-accounts cron with the rest of the behavioral data.
--
-- Apply to BOTH dev and prod.

CREATE TABLE IF NOT EXISTS public.user_filter_summaries (
  user_id    uuid        PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  filters    jsonb       NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_filter_summaries ENABLE ROW LEVEL SECURITY;
-- No policies: read and written by the service role only.
