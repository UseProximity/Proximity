export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/getRequestUser";
import supabase from "@/lib/supabase";
import { savedList } from "@/lib/listings/leasePrefsColumns";

/*
 * The signed-in user's bed counts, move-in month and lease lengths, the three
 * answers every listing's lease options are narrowed by. Read on its own because the listing
 * page needs only these, and /api/getUser builds the whole dashboard. Sizes
 * and lengths are lists (Wyatt, 2026-11-01), read from the *_list columns
 * and falling back to the single values saved before them.
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

    const read = (cols) => {
      const query = supabase.from("users").select(cols);
      return (requestUser.id ? query.eq("id", requestUser.id) : query.eq("email", requestUser.email)).maybeSingle();
    };
    const SINGLES = "preferred_move_in_date, preferred_lease_months, preferred_beds";
    let { data, error } = await read(`${SINGLES}, preferred_beds_list, preferred_lease_months_list`);
    // Before migration 202611010001 the list columns don't exist: read the singles.
    if (error) ({ data, error } = await read(SINGLES));

    if (error) {
      console.error("[lease-preferences] read failed:", error.message);
      return NextResponse.json({ error: "Failed to load preferences" }, { status: 500 });
    }

    return NextResponse.json(
      {
        moveIn: data?.preferred_move_in_date ?? null,
        months: savedList(data?.preferred_lease_months_list, data?.preferred_lease_months),
        beds: savedList(data?.preferred_beds_list, data?.preferred_beds),
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    console.error("[lease-preferences] failed:", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
