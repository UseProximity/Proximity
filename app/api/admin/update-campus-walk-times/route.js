import { NextResponse } from "next/server";
import connectMongo from "@/libs/mongoose";
import Listing from "@/models/Listing";
import { WASHU_PLACES, CAMPUS, SHUTTLE_STOPS } from "@/utils/washuPlaces";

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function fetchWalkMinutes(lat, lng, destLat, destLng) {
  const token  = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  const origin = `${lng},${lat}`;
  const dest   = `${destLng},${destLat}`;
  const url    = `https://api.mapbox.com/directions/v5/mapbox/walking/${origin};${dest}?access_token=${token}`;
  const res    = await fetch(url);
  const data   = await res.json();
  const seconds = data.routes?.[0]?.duration ?? null;
  return seconds != null ? Math.round(seconds / 60) : null;
}

export async function POST() {
  try {
    await connectMongo();

    const listings = await Listing.find({
      latitude:  { $exists: true, $ne: null },
      longitude: { $exists: true, $ne: null },
    }).select("_id latitude longitude");

    let updated = 0;
    let failed  = 0;

    for (const listing of listings) {
      try {
        const { latitude: lat, longitude: lng } = listing;

        // Campus walk time
        const campusWalkMinutes = await fetchWalkMinutes(lat, lng, CAMPUS.lat, CAMPUS.lng);

        // All places walk times
        const placeResults = await Promise.all(
          WASHU_PLACES.map(async (place) => {
            const minutes = await fetchWalkMinutes(lat, lng, place.lat, place.lng);
            return [place.name, minutes];
          })
        );
        const placeWalkMinutes = Object.fromEntries(placeResults.filter(([, m]) => m != null));

        // Shuttle stop walk times — only check 5 nearest to avoid rate limiting
        const nearest5 = [...SHUTTLE_STOPS]
          .sort((a, b) => haversineKm(lat, lng, a.lat, a.lng) - haversineKm(lat, lng, b.lat, b.lng))
          .slice(0, 5);
        const shuttleTimes = await Promise.all(nearest5.map((s) => fetchWalkMinutes(lat, lng, s.lat, s.lng)));
        const validShuttle = shuttleTimes.filter((m) => m != null);
        const shuttleWalkMinutes = validShuttle.length > 0 ? Math.min(...validShuttle) : null;

        await Listing.findByIdAndUpdate(listing._id, { $set: { campusWalkMinutes, placeWalkMinutes, shuttleWalkMinutes } });
        updated++;
      } catch {
        failed++;
      }
    }

    return NextResponse.json({ updated, failed, total: listings.length });
  } catch (e) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}
