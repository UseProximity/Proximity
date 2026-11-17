-- A listing Mapbox has no cycling route for is stored with minutes NULL, so it
-- is recorded as checked. Without that row every bike search asked Mapbox
-- again for the same un-routable listings and used up the per-request fill
-- budget, leaving real gaps unfilled. Readers treat NULL as "not on file".

ALTER TABLE listing_bike_times ALTER COLUMN minutes DROP NOT NULL;
