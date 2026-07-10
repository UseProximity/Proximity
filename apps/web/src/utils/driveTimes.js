import { haversineKm } from "@/utils/walkTimes";
import { DRIVE_PLACES, NEAREST_DRIVE_POOLS } from "@/utils/drivePlaces";

export async function fetchDriveMinutes(lat, lng, destLat, destLng) {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${lng},${lat};${destLng},${destLat}?access_token=${token}`;
  const res = await fetch(url);
  const data = await res.json();
  const seconds = data.routes?.[0]?.duration ?? null;
  return seconds != null ? Math.round(seconds / 60) : null;
}

// Live "nearest of a type" lookup via the Mapbox Search Box category endpoint.
// Returns [{ lat, lng }] proximity-ordered, or [] on empty/error so callers can
// fall back to a curated pool.
export async function fetchNearbyCategory(categoryId, lat, lng, limit = 10) {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  const url = `https://api.mapbox.com/search/searchbox/v1/category/${categoryId}?proximity=${lng},${lat}&limit=${limit}&access_token=${token}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.features ?? [])
      .map((f) => {
        const [fLng, fLat] = f.geometry?.coordinates ?? [];
        return fLat != null && fLng != null ? { lat: fLat, lng: fLng } : null;
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

// Returns { placeDriveMinutes }: a { locationName: minutes } map keyed by the
// locations-table row names. Fixed destinations use their own name; each nearest
// pool stores its fastest candidate under the synthetic `*_nearest` row name.
// Throws on failure — callers handle errors.
export async function fetchAllDriveTimes(latitude, longitude) {
  const placeResults = await Promise.all(
    DRIVE_PLACES.map(async (place) => {
      const minutes = await fetchDriveMinutes(latitude, longitude, place.lat, place.lng);
      return [place.name, minutes];
    })
  );
  const placeDriveMinutes = Object.fromEntries(placeResults.filter(([, m]) => m != null));

  // For each nearest pool, gather candidates, then only route the 5 closest
  // (by haversine) to avoid rate limiting, and keep the fastest driving time.
  // Pools with a mapboxCategory use a live category search; if it returns
  // nothing (outage/empty), we fall back to the curated candidate pool.
  for (const pool of NEAREST_DRIVE_POOLS) {
    let candidates = pool.candidates;
    if (pool.mapboxCategory) {
      const live = await fetchNearbyCategory(pool.mapboxCategory, latitude, longitude);
      if (live.length > 0) candidates = live;
    }
    const nearest5 = [...candidates]
      .sort(
        (a, b) =>
          haversineKm(latitude, longitude, a.lat, a.lng) -
          haversineKm(latitude, longitude, b.lat, b.lng)
      )
      .slice(0, 5);
    const times = await Promise.all(
      nearest5.map((c) => fetchDriveMinutes(latitude, longitude, c.lat, c.lng))
    );
    const valid = times.filter((m) => m != null);
    if (valid.length > 0) {
      placeDriveMinutes[pool.resultName] = Math.min(...valid);
    }
  }

  return { placeDriveMinutes };
}
