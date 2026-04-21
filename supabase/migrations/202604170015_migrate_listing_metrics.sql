-- Migrates listing_metrics_daily: adds metric_type_id FK, migrates from metric_type text,
-- adds unique constraint for increment_listing_metric ON CONFLICT, drops landlord_id.

ALTER TABLE listing_metrics_daily ADD COLUMN IF NOT EXISTS metric_type_id uuid REFERENCES metric_types(id);

-- Populate metric_type_id from metric_type text (case-insensitive match).
UPDATE listing_metrics_daily lmd
SET metric_type_id = mt.id
FROM metric_types mt
WHERE LOWER(mt.name) = LOWER(lmd.metric_type)
  AND lmd.metric_type_id IS NULL;

-- NOTE: Deferred to Phase 3 (0025):
--   DELETE FROM listing_metrics_daily WHERE metric_type_id IS NULL
--   DROP COLUMN metric_type, landlord_id
--   ALTER COLUMN metric_type_id SET NOT NULL
--   ADD CONSTRAINT listing_metrics_daily_listing_metric_date_key UNIQUE (listing_id, metric_type_id, recorded_date)
-- Reason: old main code's increment_listing_metric writes metric_type + landlord_id and does
-- not populate metric_type_id. NOT NULL + unique constraint would break those writes during
-- the validation window.

CREATE INDEX IF NOT EXISTS idx_listing_metrics_type ON listing_metrics_daily (listing_id, metric_type_id, recorded_date) WHERE metric_type_id IS NOT NULL;

DO $$ DECLARE v_count bigint;
BEGIN
  SELECT COUNT(*) INTO v_count FROM listing_metrics_daily WHERE metric_type_id IS NOT NULL;
  RAISE NOTICE 'Migration 0015: % listing_metrics_daily rows updated with metric_type_id.', v_count;
END $$;
