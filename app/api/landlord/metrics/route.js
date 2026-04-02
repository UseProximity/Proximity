export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import supabase from "@/libs/supabase";

// GET /api/landlord/metrics?range=7d|30d|6m&listingIds=id1,id2,...
export async function GET(req) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!["landlord", "super"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const range = searchParams.get("range") || "30d";
  const listingIdsParam = searchParams.get("listingIds") || "";

  const daysBack = range === "7d" ? 7 : range === "6m" ? 182 : 30;
  const startDate = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);
  const startDateStr = startDate.toISOString().split("T")[0];

  // Fetch all listings for this landlord (used for the dropdown)
  const { data: listings, error: listingsError } = await supabase
    .from("listings")
    .select("id, address, title")
    .eq("landlord_id", session.user.id)
    .order("created_at", { ascending: false });

  if (listingsError) {
    return NextResponse.json({ error: listingsError.message }, { status: 500 });
  }

  const allIds = (listings ?? []).map((l) => l.id);
  let targetIds = allIds;
  if (listingIdsParam.trim()) {
    const requested = listingIdsParam
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    // Only allow IDs that belong to this landlord
    targetIds = requested.filter((id) => allIds.includes(id));
  }

  let metrics = [];
  if (targetIds.length > 0) {
    const { data, error: metricsError } = await supabase
      .from("listing_metrics_daily")
      .select("listing_id, metric_type, recorded_date, count")
      .in("listing_id", targetIds)
      .gte("recorded_date", startDateStr)
      .order("recorded_date", { ascending: true });

    if (metricsError) {
      return NextResponse.json({ error: metricsError.message }, { status: 500 });
    }
    metrics = data ?? [];
  }

  return NextResponse.json({ listings: listings ?? [], metrics });
}
