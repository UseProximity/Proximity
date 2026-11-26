import { CAMPUS } from "@/utils/washuPlaces";

// One Mapbox call may hold up a search, so it gets a hard limit.
const TIMEOUT_MS = 5000;

// Bike minutes from a point to campus (Danforth University Center), from the
// Mapbox cycling profile. Mirrors fetchWalkMinutes in utils/walkTimes.js.
//   number  the ride time
//   null    Mapbox answered and has no cycling route from here
// A failed call (timeout, rate limit, any non-2xx) throws instead, so a
// caller never mistakes a passing outage for "no route".
export async function fetchBikeMinutes(lat, lng) {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  const url = `https://api.mapbox.com/directions/v5/mapbox/cycling/${lng},${lat};${CAMPUS.lng},${CAMPUS.lat}?access_token=${token}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Mapbox cycling ${res.status}`);
  const data = await res.json();
  const seconds = data.routes?.[0]?.duration ?? null;
  return seconds != null ? Math.round(seconds / 60) : null;
}
