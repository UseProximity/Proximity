export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import supabase from "@/lib/supabase";
import { getOwnedListings } from "@/lib/listings/ownership";
import { resolveDashboardUserId } from "@/lib/users/viewAs";

async function requireLandlordOrSuper() {
  const session = await auth();
  if (!session?.user?.id) return null;
  if (!["landlord", "super", "admin"].includes(session.user.role)) return null;
  return session;
}

// GET /api/landlord/listings — all listings owned by the current landlord (or viewAs target)
export async function GET(req) {
  const session = await requireLandlordOrSuper();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const targetUserId = resolveDashboardUserId(session, searchParams);

  /*
   * Includes properties the landlord only holds a LEASE at, not just ones they
   * own the record for — otherwise a landlord who attached an offering to an
   * existing property would never see it again after publishing.
   *
   * Each row carries `ownership` so the dashboard can tell the two apart:
   * "property" may edit the listing and its units, "lease" may only edit its own
   * offering. See lib/listings/ownership.js.
   */
  const owned = await getOwnedListings(targetUserId);
  const ids = [...owned.keys()];
  if (ids.length === 0) return NextResponse.json([]);

  const { data, error } = await supabase
    .from("listings")
    .select("*, listing_units(bedrooms, bathrooms, area)")
    .in("id", ids)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(
    (data ?? []).map((row) => ({ ...row, ownership: owned.get(row.id) ?? "lease" }))
  );
}
