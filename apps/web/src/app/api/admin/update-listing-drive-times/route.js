import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseClient } from "@/lib/supabase";
import { fetchAllDriveTimes } from "@/utils/driveTimes";
import { DRIVE_PLACES, NEAREST_DRIVE_POOLS } from "@/utils/drivePlaces";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Backfill / refresh driving times for every listing. Mirrors
// update-campus-walk-times, but reuses fetchAllDriveTimes (identical to the
// addListing computation) and upserts, so re-running also refreshes existing
// rows with the latest hybrid nearest-gas/pharmacy results.
export async function POST(req) {
  try {
    const session = await auth();
    if (!session || !["super", "admin"].includes(session.user.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const dbTarget = req.headers.get("x-db-target");
    const supabase = getSupabaseClient(dbTarget === "prod" || dbTarget === "dev" ? dbTarget : undefined);

    // ?force=true recomputes every listing (refresh). Default is resumable:
    // only listings missing any expected destination are processed.
    const force = new URL(req.url).searchParams.get("force") === "true";

    const [{ data: listings, error: listErr }, { data: locations, error: locErr }, { data: existing, error: existErr }] = await Promise.all([
      supabase
        .from("listings")
        .select("id, latitude, longitude")
        .not("latitude", "is", null)
        .not("longitude", "is", null),
      supabase.from("locations").select("id, name"),
      supabase.from("listing_drive_times").select("listing_id, location_id"),
    ]);

    if (listErr) return NextResponse.json({ error: listErr.message }, { status: 500 });
    if (locErr)  return NextResponse.json({ error: locErr.message  }, { status: 500 });
    if (existErr) return NextResponse.json({ error: existErr.message }, { status: 500 });

    const locByName = new Map((locations ?? []).map((l) => [l.name.toLowerCase(), l]));

    // Every destination we try to store — used to detect partial backfills so
    // re-runs fill gaps instead of skipping a listing after one good row.
    const expectedLocIds = new Set();
    for (const place of DRIVE_PLACES) {
      const loc = locByName.get(place.name.toLowerCase());
      if (loc) expectedLocIds.add(loc.id);
    }
    for (const pool of NEAREST_DRIVE_POOLS) {
      const loc = locByName.get(pool.resultName.toLowerCase());
      if (loc) expectedLocIds.add(loc.id);
    }

    const existingByListing = new Map();
    for (const row of existing ?? []) {
      if (!existingByListing.has(row.listing_id)) {
        existingByListing.set(row.listing_id, new Set());
      }
      existingByListing.get(row.listing_id).add(row.location_id);
    }

    let updated = 0;
    let skipped = 0;
    let failed  = 0;

    for (let i = 0; i < (listings ?? []).length; i++) {
      const listing = listings[i];
      const { id: listingId, latitude: lat, longitude: lng } = listing;

      const existingLocIds = existingByListing.get(listingId) ?? new Set();
      const missingLocIds = [...expectedLocIds].filter((id) => !existingLocIds.has(id));

      if (!force && missingLocIds.length === 0) {
        skipped++;
        continue;
      }

      let succeeded = false;
      for (let attempt = 0; attempt < 2 && !succeeded; attempt++) {
        try {
          if (attempt > 0) await sleep(1500);

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
            failed++;
            break;
          }

          const { error: upsertErr } = await supabase
            .from("listing_drive_times")
            .upsert(rows, { onConflict: "listing_id,location_id" });
          if (upsertErr) throw upsertErr;

          updated++;
          succeeded = true;
        } catch (err) {
          if (attempt === 1) {
            console.error("[update-listing-drive-times] failed for", listingId, err?.message);
            failed++;
          }
        }
      }

      // Pace Mapbox calls — each listing triggers ~15+ direction requests.
      if (i < listings.length - 1) await sleep(300);
    }

    return NextResponse.json({ updated, skipped, failed, total: (listings ?? []).length });
  } catch (e) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}
