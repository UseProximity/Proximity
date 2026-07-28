// Ported from apps/web/src/components/listings/MapView.js's
// computeBoundsExcludingOutliers + the symmetric-bounds-around-campus logic
// used for the initial fit-to-listings camera. MAP_CAMPUS_CENTER is web's own
// separate hardcoded "map center" point — distinct from WASHU_PLACES' Danforth
// University Center entry (a pre-existing inconsistency in web itself, kept
// as-is rather than unified).
export const MAP_CAMPUS_CENTER = {
  longitude: -90.3053,
  latitude: 38.6489,
};

function computeBoundsExcludingOutliers(listings) {
  if (listings.length === 0) return null;
  const lats = listings.map((l) => l.latitude);
  const lngs = listings.map((l) => l.longitude);
  const meanLat = lats.reduce((s, v) => s + v, 0) / lats.length;
  const meanLng = lngs.reduce((s, v) => s + v, 0) / lngs.length;
  const stdLat = Math.sqrt(lats.reduce((s, v) => s + (v - meanLat) ** 2, 0) / lats.length);
  const stdLng = Math.sqrt(lngs.reduce((s, v) => s + (v - meanLng) ** 2, 0) / lngs.length);
  const filtered = listings.filter(
    (l) => Math.abs(l.latitude - meanLat) <= 2 * (stdLat || 1) && Math.abs(l.longitude - meanLng) <= 2 * (stdLng || 1)
  );
  const pool = filtered.length > 0 ? filtered : listings;
  return [
    [Math.min(...pool.map((l) => l.longitude)), Math.min(...pool.map((l) => l.latitude))],
    [Math.max(...pool.map((l) => l.longitude)), Math.max(...pool.map((l) => l.latitude))],
  ];
}

// Returns { ne: [lng, lat], sw: [lng, lat] } symmetric around MAP_CAMPUS_CENTER,
// sized to fit every listing (outliers >2 std devs from the mean excluded so
// one distant listing doesn't zoom the whole map out), or null if no listing
// has valid coordinates.
export function computeListingMapBounds(listings) {
  const valid = (listings ?? []).filter((l) => Number.isFinite(l.latitude) && Number.isFinite(l.longitude));
  const bounds = computeBoundsExcludingOutliers(valid);
  if (!bounds) return null;

  const { longitude: campusLng, latitude: campusLat } = MAP_CAMPUS_CENTER;
  const maxDeltaLng = Math.max(Math.abs(campusLng - bounds[0][0]), Math.abs(bounds[1][0] - campusLng));
  const maxDeltaLat = Math.max(Math.abs(campusLat - bounds[0][1]), Math.abs(bounds[1][1] - campusLat));

  return {
    ne: [campusLng + maxDeltaLng, campusLat + maxDeltaLat],
    sw: [campusLng - maxDeltaLng, campusLat - maxDeltaLat],
  };
}
