-- Bike time from each listing to campus (Danforth University Center), in
-- minutes, from the Mapbox cycling profile. One row per listing. Read by Find
-- Your Place to judge a student's "longest bike ride" answer; filled by
-- lib/findYourPlace/commute.js (on demand) and the admin backfill route.
--
-- Unlike listing_walk_times / listing_drive_times there is a single
-- destination, so there is no location_id.

CREATE TABLE IF NOT EXISTS listing_bike_times (
  listing_id  uuid PRIMARY KEY REFERENCES listings(id) ON DELETE CASCADE,
  minutes     integer NOT NULL CHECK (minutes >= 0),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE listing_bike_times ENABLE ROW LEVEL SECURITY;

-- Public read, like the walk and drive tables. No write policy: only the
-- service role (server code) writes these rows.
DROP POLICY IF EXISTS listing_bike_times_select ON listing_bike_times;
CREATE POLICY listing_bike_times_select
ON listing_bike_times
FOR SELECT
USING (true);
