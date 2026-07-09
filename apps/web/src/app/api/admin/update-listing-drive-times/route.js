import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseClient } from "@/lib/supabase";
import { fetchAllDriveTimes } from "@/utils/driveTimes";

// Backfill / refresh driving times for every listing. Mirrors
// update-campus-walk-times, but reuses fetchAllDriveTimes (identical to the
// addListing computation) and upserts, so re-running also refreshes existing
// rows with the latest hybrid nearest-gas/pharmacy results.
export async function POST(req) {
  try {
    const session = await auth();
    if (!session || session.user.role !== "super") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const dbTarget = req.headers.get("x-db-target");
    const supabase = getSupabaseClient(dbTarget === "prod" || dbTarget === "dev" ? dbTarget : undefined);

    // ?force=true recomputes every listing (refresh). Default is resumable:
    // listings that already have drive times are skipped, so re-running only
    // fills gaps left by transient Mapbox failures/rate-limits.
    const force = new URL(req.url).searchParams.get("force") === "true";

    const [{ data: listings, error: listErr }, { data: locations, error: locErr }, { data: existing, error: existErr }] = await Promise.all([
      supabase
        .from("listings")
        .select("id, latitude, longitude")
        .not("latitude", "is", null)
        .not("longitude", "is", null),
      supabase.from("locations").select("id, name"),
      supabase.from("listing_drive_times").select("listing_id"),
    ]);

    if (listErr) return NextResponse.json({ error: listErr.message }, { status: 500 });
    if (locErr)  return NextResponse.json({ error: locErr.message  }, { status: 500 });
    if (existErr) return NextResponse.json({ error: existErr.message }, { status: 500 });

    const locByName = new Map((locations ?? []).map((l) => [l.name.toLowerCase(), l]));
    const alreadyHasDriveTimes = new Set((existing ?? []).map((r) => r.listing_id));

    let updated = 0;
    let skipped = 0;
    let failed  = 0;

    for (const listing of listings ?? []) {
      try {
        const { id: listingId, latitude: lat, longitude: lng } = listing;

        if (!force && alreadyHasDriveTimes.has(listingId)) {
          skipped++;
          continue;
        }

        const { placeDriveMinutes } = await fetchAllDriveTimes(lat, lng);

        // Resolve result keys → locations rows by name (same match as addListing).
        const rows = [];
        for (const [key, minutes] of Object.entries(placeDriveMinutes ?? {})) {
          const loc = locByName.get(key.toLowerCase());
          if (loc && minutes != null) {
            rows.push({ listing_id: listingId, location_id: loc.id, minutes });
          }
        }

        if (rows.length === 0) {
          skipped++;
          continue;
        }

        const { error: upsertErr } = await supabase
          .from("listing_drive_times")
          .upsert(rows, { onConflict: "listing_id,location_id" });
        if (upsertErr) throw upsertErr;
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
