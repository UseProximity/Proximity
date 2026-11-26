-- One analysis per lease check, enforced with an atomic claim.
--
-- PUT /api/lease-check refused a check whose summary was already set, but the
-- summary is only written when the Sonnet run returns a minute or two later.
-- So a burst of parallel PUTs for one check each passed the test and each
-- started a paid analysis on the scanner key (and exhausting its rate limit
-- broke Lease Check for every other student). The route now claims the row
-- with a conditional UPDATE on this column before any R2 or model work, and a
-- failed run clears it again so the student can retry.

ALTER TABLE lease_checks ADD COLUMN IF NOT EXISTS analysis_started_at timestamptz;
