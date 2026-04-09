import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseClient } from "@/libs/supabase";
import { fetchWalkMinutes, haversineKm } from "@/utils/walkTimes";
import { WASHU_PLACES, SHUTTLE_STOPS } from "@/utils/washuPlaces";

export async function POST(req) {
  try {
    const session = await auth();
    if (!session || session.user.role !== "super") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const dbTarget = req.headers.get("x-db-target");
    const supabase = getSupabaseClient(dbTarget === "prod" || dbTarget === "dev" ? dbTarget : undefined);

    const { data: listings, error } = await supabase
      .from("listings")
      .select("id, latitude, longitude, place_walk_minutes, shuttle_walk_minutes")
      .not("latitude", "is", null)
      .not("longitude", "is", null);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    let updated = 0;
    let skipped = 0;
    let failed  = 0;

    for (const listing of listings || []) {
      try {
        const { latitude: lat, longitude: lng } = listing;
        const existing = typeof listing.place_walk_minutes === "object" && listing.place_walk_minutes !== null
          ? listing.place_walk_minutes
          : {};

        // Find places that don't already have a walk time
        const missingPlaces = WASHU_PLACES.filter((p) => existing[p.name] == null);
        const needsShuttle = listing.shuttle_walk_minutes == null;

        if (missingPlaces.length === 0 && !needsShuttle) {
          skipped++;
          continue;
        }

        const patch = {};

        // Fetch only missing place walk times
        if (missingPlaces.length > 0) {
          const newEntries = await Promise.all(
            missingPlaces.map(async (place) => {
              const minutes = await fetchWalkMinutes(lat, lng, place.lat, place.lng);
              return [place.name, minutes];
            })
          );
          const newPlaceTimes = Object.fromEntries(newEntries.filter(([, m]) => m != null));
          patch.place_walk_minutes = { ...existing, ...newPlaceTimes };
        }

        // Fetch shuttle walk time only if not already set
        if (needsShuttle) {
          const nearest5 = [...SHUTTLE_STOPS]
            .sort((a, b) => haversineKm(lat, lng, a.lat, a.lng) - haversineKm(lat, lng, b.lat, b.lng))
            .slice(0, 5);
          const shuttleTimes = await Promise.all(
            nearest5.map((s) => fetchWalkMinutes(lat, lng, s.lat, s.lng))
          );
          const valid = shuttleTimes.filter((m) => m != null);
          if (valid.length > 0) patch.shuttle_walk_minutes = Math.min(...valid);
        }

        if (Object.keys(patch).length === 0) {
          skipped++;
          continue;
        }

        const { error: updateError } = await supabase
          .from("listings")
          .update(patch)
          .eq("id", listing.id);
        if (updateError) throw updateError;
        updated++;
      } catch {
        failed++;
      }
    }

    return NextResponse.json({ updated, skipped, failed, total: (listings || []).length });
  } catch (e) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}
