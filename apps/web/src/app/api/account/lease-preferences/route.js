export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/getRequestUser";
import supabase from "@/lib/supabase";

/*
 * The signed-in user's bed count, move-in month and lease length, the three
 * answers every listing's lease options are narrowed by. Read on its own because the listing
 * page needs only these, and /api/getUser builds the whole dashboard.
 *
 * Writes go through PATCH /api/editProfile (preferredBeds, preferredMoveInDate,
 * preferredLeaseMonths) like every other profile field.
 *
 * @auth any
 */
export async function GET(req) {
  try {
    const requestUser = await getRequestUser(req);
    if (!requestUser?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let query = supabase.from("users").select("preferred_move_in_date, preferred_lease_months, preferred_beds");
    query = requestUser.id ? query.eq("id", requestUser.id) : query.eq("email", requestUser.email);
    const { data, error } = await query.maybeSingle();

    if (error) {
      console.error("[lease-preferences] read failed:", error.message);
      return NextResponse.json({ error: "Failed to load preferences" }, { status: 500 });
    }

    return NextResponse.json(
      {
        moveIn: data?.preferred_move_in_date ?? null,
        months: data?.preferred_lease_months ?? null,
        beds: data?.preferred_beds ?? null,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    console.error("[lease-preferences] failed:", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
