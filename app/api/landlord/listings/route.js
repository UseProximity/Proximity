export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import supabase from "@/libs/supabase";

async function requireLandlordOrSuper() {
  const session = await auth();
  if (!session?.user?.id) return null;
  if (!["landlord", "super"].includes(session.user.role)) return null;
  return session;
}

// GET /api/landlord/listings — all listings owned by the current landlord (or viewAs target)
export async function GET(req) {
  const session = await requireLandlordOrSuper();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const viewAsId = searchParams.get("viewAs");
  const targetUserId = (viewAsId && session.user.role === "super") ? viewAsId : session.user.id;

  const { data: ll } = await supabase
    .from("listing_landlords")
    .select("listing_id")
    .eq("user_id", targetUserId);

  const ids = (ll ?? []).map((r) => r.listing_id);
  if (ids.length === 0) return NextResponse.json([]);

  const { data, error } = await supabase
    .from("listings")
    .select("*, listing_units(bedrooms, bathrooms, area)")
    .in("id", ids)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}
