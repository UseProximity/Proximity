import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseClient } from "@/libs/supabase";
import { fetchAllWalkTimes } from "@/utils/walkTimes";

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
      .select("id, latitude, longitude")
      .not("latitude", "is", null)
      .not("longitude", "is", null);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    let updated = 0;
    let failed  = 0;

    for (const listing of listings || []) {
      try {
        const { latitude: lat, longitude: lng } = listing;
        const { placeWalkMinutes, shuttleWalkMinutes } = await fetchAllWalkTimes(lat, lng);
        const { error: updateError } = await supabase
          .from("listings")
          .update({ place_walk_minutes: placeWalkMinutes, shuttle_walk_minutes: shuttleWalkMinutes })
          .eq("id", listing.id);
        if (updateError) throw updateError;
        updated++;
      } catch {
        failed++;
      }
    }

    return NextResponse.json({ updated, failed, total: (listings || []).length });
  } catch (e) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}
