import { WASHU_PLACES, SHUTTLE_STOPS } from "@/utils/washuPlaces";

export function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export async function fetchWalkMinutes(lat, lng, destLat, destLng) {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  const url = `https://api.mapbox.com/directions/v5/mapbox/walking/${lng},${lat};${destLng},${destLat}?access_token=${token}`;
  const res = await fetch(url);
  const data = await res.json();
  const seconds = data.routes?.[0]?.duration ?? null;
  return seconds != null ? Math.round(seconds / 60) : null;
}

// Returns { placeWalkMinutes, shuttleWalkMinutes }. Throws on failure — callers handle errors.
export async function fetchAllWalkTimes(latitude, longitude) {
  const placeResults = await Promise.all(
    WASHU_PLACES.map(async (place) => {
      const minutes = await fetchWalkMinutes(latitude, longitude, place.lat, place.lng);
      return [place.name, minutes];
    })
  );
  const placeWalkMinutes = Object.fromEntries(placeResults.filter(([, m]) => m != null));

  // Only check 5 nearest stops to avoid rate limiting
  const nearest5 = [...SHUTTLE_STOPS]
    .sort((a, b) => haversineKm(latitude, longitude, a.lat, a.lng) - haversineKm(latitude, longitude, b.lat, b.lng))
    .slice(0, 5);
  const shuttleTimes = await Promise.all(
    nearest5.map((s) => fetchWalkMinutes(latitude, longitude, s.lat, s.lng))
  );
  const validShuttle = shuttleTimes.filter((m) => m != null);
  const shuttleWalkMinutes = validShuttle.length > 0 ? Math.min(...validShuttle) : null;

  return { placeWalkMinutes, shuttleWalkMinutes };
}
