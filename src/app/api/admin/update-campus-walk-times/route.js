import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseClient } from "@/lib/supabase";
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

    const [{ data: listings, error: listErr }, { data: locations, error: locErr }] = await Promise.all([
      supabase
        .from("listings")
        .select("id, latitude, longitude")
        .not("latitude", "is", null)
        .not("longitude", "is", null),
      supabase.from("locations").select("id, name"),
    ]);

    if (listErr) return NextResponse.json({ error: listErr.message }, { status: 500 });
    if (locErr)  return NextResponse.json({ error: locErr.message  }, { status: 500 });

    const locByName = new Map((locations ?? []).map((l) => [l.name.toLowerCase(), l]));
    const shuttleNearest = locByName.get("shuttle_nearest");

    let updated = 0;
    let skipped = 0;
    let failed  = 0;

    for (const listing of listings ?? []) {
      try {
        const { id: listingId, latitude: lat, longitude: lng } = listing;

        const { data: existingRows, error: existErr } = await supabase
          .from("listing_walk_times")
          .select("location_id")
          .eq("listing_id", listingId);
        if (existErr) throw existErr;
        const existingLocIds = new Set((existingRows ?? []).map((r) => r.location_id));

        const rowsToInsert = [];

        for (const place of WASHU_PLACES) {
          const loc = locByName.get(place.name.toLowerCase());
          if (!loc || existingLocIds.has(loc.id)) continue;
          const minutes = await fetchWalkMinutes(lat, lng, place.lat, place.lng);
          if (minutes != null) {
            rowsToInsert.push({ listing_id: listingId, location_id: loc.id, minutes });
          }
        }

        if (shuttleNearest && !existingLocIds.has(shuttleNearest.id)) {
          const nearest5 = [...SHUTTLE_STOPS]
            .sort((a, b) => haversineKm(lat, lng, a.lat, a.lng) - haversineKm(lat, lng, b.lat, b.lng))
            .slice(0, 5);
          const shuttleTimes = await Promise.all(
            nearest5.map((s) => fetchWalkMinutes(lat, lng, s.lat, s.lng))
          );
          const valid = shuttleTimes.filter((m) => m != null);
          if (valid.length > 0) {
            rowsToInsert.push({
              listing_id: listingId,
              location_id: shuttleNearest.id,
              minutes: Math.min(...valid),
            });
          }
        }

        if (rowsToInsert.length === 0) {
          skipped++;
          continue;
        }

        const { error: insertErr } = await supabase
          .from("listing_walk_times")
          .insert(rowsToInsert);
        if (insertErr) throw insertErr;
        updated++;
      } catch {
        failed++;
      }
    }

    return NextResponse.json({ updated, skipped, failed, total: (listings ?? []).length });
  } catch (e) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}
