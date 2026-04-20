-- Creates fn_get_listing_aggregates() and replaces increment_listing_metric().
-- fn_get_listing_aggregates replaces the stored num_reviews/rating/num_saves/num_clicks columns.
-- increment_listing_metric is updated to use metric_type_id FK instead of text + landlord_id.

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

-- Replaces the old increment_listing_metric (which took p_landlord_id + p_metric_type text + p_date).
-- New signature: (p_listing_id uuid, p_metric_name text).
-- Upserts into listing_metrics_daily using today's date.
CREATE OR REPLACE FUNCTION increment_listing_metric(
  p_listing_id  uuid,
  p_metric_name text
) RETURNS void AS $$
DECLARE
  v_metric_type_id  uuid;
BEGIN
  SELECT id INTO v_metric_type_id FROM metric_types WHERE name = p_metric_name;
  IF v_metric_type_id IS NULL THEN
    RAISE EXCEPTION 'Unknown metric type: %', p_metric_name;
  END IF;

  INSERT INTO listing_metrics_daily (listing_id, metric_type_id, recorded_date, count)
  VALUES (p_listing_id, v_metric_type_id, CURRENT_DATE, 1)
  ON CONFLICT (listing_id, metric_type_id, recorded_date)
  DO UPDATE SET count = listing_metrics_daily.count + 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DO $$ BEGIN RAISE NOTICE 'Migration 0023: fn_get_listing_aggregates() and increment_listing_metric() created.'; END $$;
