import { CAMPUS } from "@/utils/washuPlaces";

// Bike minutes from a point to campus (Danforth University Center), from the
// Mapbox cycling profile. null when Mapbox has no route. Mirrors
// fetchWalkMinutes in utils/walkTimes.js.
export async function fetchBikeMinutes(lat, lng) {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  const url = `https://api.mapbox.com/directions/v5/mapbox/cycling/${lng},${lat};${CAMPUS.lng},${CAMPUS.lat}?access_token=${token}`;
  const res = await fetch(url);
  const data = await res.json();
  const seconds = data.routes?.[0]?.duration ?? null;
  return seconds != null ? Math.round(seconds / 60) : null;
}
