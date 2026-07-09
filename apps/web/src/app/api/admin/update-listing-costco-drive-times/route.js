import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseClient } from "@/lib/supabase";
import { fetchDriveMinutes } from "@/utils/driveTimes";
import { DRIVE_PLACES } from "@/utils/drivePlaces";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const COSTCO_PLACE = DRIVE_PLACES.find((p) => p.name.startsWith("Costco"));

// Recompute driving time to the current Costco destination for every listing.
// One Mapbox Directions call per listing — use after moving/updating Costco coords.
export async function POST(req) {
  try {
    const session = await auth();
    if (!session || !["super", "admin"].includes(session.user.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (!COSTCO_PLACE) {
      return NextResponse.json({ error: "Costco place not configured in drivePlaces.js" }, { status: 500 });
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
    if (locErr) return NextResponse.json({ error: locErr.message }, { status: 500 });

    const costcoLoc = (locations ?? []).find(
      (l) => l.name.toLowerCase() === COSTCO_PLACE.name.toLowerCase()
    );
    if (!costcoLoc) {
      return NextResponse.json(
        { error: `locations row not found for "${COSTCO_PLACE.name}"` },
        { status: 500 }
      );
    }

    // Drop stale rows for other Costco locations (e.g. Manchester after Olivette rename).
    const staleCostcoLocIds = (locations ?? [])
      .filter(
        (l) =>
          l.name.toLowerCase().startsWith("costco") &&
          l.name.toLowerCase() !== COSTCO_PLACE.name.toLowerCase()
      )
      .map((l) => l.id);
    if (staleCostcoLocIds.length > 0) {
      await supabase.from("listing_drive_times").delete().in("location_id", staleCostcoLocIds);
    }

    let updated = 0;
    let failed = 0;

    for (let i = 0; i < (listings ?? []).length; i++) {
      const { id: listingId, latitude: lat, longitude: lng } = listings[i];
      try {
        const minutes = await fetchDriveMinutes(lat, lng, COSTCO_PLACE.lat, COSTCO_PLACE.lng);
        if (minutes == null) {
          failed++;
          continue;
        }

        const { error: upsertErr } = await supabase
          .from("listing_drive_times")
          .upsert(
            { listing_id: listingId, location_id: costcoLoc.id, minutes },
            { onConflict: "listing_id,location_id" }
          );
        if (upsertErr) throw upsertErr;
        updated++;
      } catch (err) {
        console.error("[update-listing-costco-drive-times] failed for", listingId, err?.message);
        failed++;
      }

      if (i < listings.length - 1) await sleep(100);
    }

    return NextResponse.json({
      updated,
      failed,
      total: (listings ?? []).length,
      destination: COSTCO_PLACE.name,
    });
  } catch (e) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}
