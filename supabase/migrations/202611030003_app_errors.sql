-- Errors the site hits in production, grouped (Wyatt, 2026-11-03).
--
-- One row per distinct problem (fingerprint: where it happened plus the
-- message with ids and numbers stripped), counted every time it recurs, so a
-- bug that fires a thousand times is one row and one email, not a thousand.
-- Written only by the server (service role) through record_app_error; read
-- by the admin Errors view. Nothing here is shown to users.

CREATE TABLE IF NOT EXISTS public.app_errors (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint      text NOT NULL UNIQUE,
  source           text NOT NULL CHECK (source IN ('server', 'browser')),
  where_label      text,             -- the route or page, e.g. "GET /api/chat/threads"
  message          text NOT NULL,
  stack            text,
  sample           jsonb NOT NULL DEFAULT '{}'::jsonb,  -- the latest occurrence: url, role, browser
  app_env          text,
  count            integer NOT NULL DEFAULT 1,
  first_seen_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at     timestamptz NOT NULL DEFAULT now(),
  last_alerted_at  timestamptz,
  alerted_count    integer NOT NULL DEFAULT 0,     -- the count when the last alert went out
  resolved_at      timestamptz,
  resolved_by      uuid REFERENCES public.users(id),
  reopened_at      timestamptz       -- set when a resolved problem happens again
);

CREATE INDEX IF NOT EXISTS app_errors_last_seen_idx ON public.app_errors (last_seen_at DESC);

ALTER TABLE public.app_errors ENABLE ROW LEVEL SECURITY;
-- No policies: only the service role reads or writes it.

-- Count one occurrence. A resolved problem that happens again is reopened.
-- Returns the row so the caller can decide whether to email.
CREATE OR REPLACE FUNCTION public.record_app_error(
  p_fingerprint text, p_source text, p_where text, p_message text,
  p_stack text, p_sample jsonb, p_env text
) RETURNS public.app_errors
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  INSERT INTO public.app_errors (fingerprint, source, where_label, message, stack, sample, app_env)
  VALUES (p_fingerprint, p_source, left(p_where, 300), left(p_message, 2000), left(p_stack, 8000), coalesce(p_sample, '{}'::jsonb), p_env)
  ON CONFLICT (fingerprint) DO UPDATE SET
    count        = public.app_errors.count + 1,
    last_seen_at = now(),
    message      = left(excluded.message, 2000),
    stack        = coalesce(excluded.stack, public.app_errors.stack),
    sample       = excluded.sample,
    reopened_at  = CASE WHEN public.app_errors.resolved_at IS NOT NULL THEN now() ELSE public.app_errors.reopened_at END,
    resolved_at  = NULL,
    resolved_by  = NULL
  RETURNING *;
$$;

REVOKE ALL ON FUNCTION public.record_app_error(text, text, text, text, text, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_app_error(text, text, text, text, text, jsonb, text) TO service_role;
REVOKE ALL ON TABLE public.app_errors FROM anon, authenticated;
