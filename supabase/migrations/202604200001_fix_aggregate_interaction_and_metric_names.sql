-- Corrects fn_get_listing_aggregates(): two bad lookups that produced zeroes.
--
-- Background: migration 0002 seeds interaction_types as ('saved','contacted','clicked')
-- and metric_types as ('clicks','saves','contacts'). Migration 0023 wrote
-- fn_get_listing_aggregates using 'favorite' and 'view' — neither value exists,
-- so favorite_count and view_count were always 0 in prod.
--
-- On dev, this migration replaces the broken function. On prod, migration 0023
-- already has the corrected body, so this is a no-op (identical CREATE OR REPLACE).

CREATE OR REPLACE FUNCTION fn_get_listing_aggregates(p_listing_ids uuid[])
RETURNS TABLE (
  listing_id      uuid,
  avg_rating      numeric,
  review_count    bigint,
  favorite_count  bigint,
  contacted_count bigint,
  view_count      bigint
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    l.id                                                                                AS listing_id,
    ROUND(AVG(lr.rating)::numeric, 2)                                                   AS avg_rating,
    COUNT(DISTINCT lr.id)                                                               AS review_count,
    COUNT(DISTINCT CASE WHEN it.name = 'saved'     THEN uli.id END)                    AS favorite_count,
    COUNT(DISTINCT CASE WHEN it.name = 'contacted' THEN uli.id END)                    AS contacted_count,
    COALESCE(SUM(CASE WHEN mt.name = 'clicks' THEN lmd.count ELSE 0 END), 0)::bigint   AS view_count
  FROM unnest(p_listing_ids) AS lid(id)
  JOIN listings l ON l.id = lid.id
  LEFT JOIN listing_reviews lr
    ON lr.listing_id = l.id AND lr.deleted_at IS NULL AND lr.legitimacy = true
  LEFT JOIN user_listing_interactions uli ON uli.listing_id = l.id
  LEFT JOIN interaction_types it ON it.id = uli.interaction_type_id
  LEFT JOIN listing_metrics_daily lmd ON lmd.listing_id = l.id
  LEFT JOIN metric_types mt ON mt.id = lmd.metric_type_id
  GROUP BY l.id;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

DO $$ BEGIN RAISE NOTICE 'Migration 202604200001: fn_get_listing_aggregates corrected (saved/clicks lookups).'; END $$;
