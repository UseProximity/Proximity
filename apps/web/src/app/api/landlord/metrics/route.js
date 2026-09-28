export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import supabase from "@/lib/supabase";
import { resolveDashboardUserId } from "@/lib/users/viewAs";

// GET /api/landlord/metrics?range=7d|30d|6m&listingIds=id1,id2,...
export async function GET(req) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  /*
   * No role check. The real guard is the scoping below: results are limited to
   * listings the CALLER owns via listing_landlords, so this returns nothing for
   * someone with no properties whatever their role. The role test added no
   * protection and did cause harm — a student who posts a sublease at a new
   * address owns that listing, and was refused metrics for their own property.
   */

  const { searchParams } = new URL(req.url);
  const range = searchParams.get("range") || "30d";
  const listingIdsParam = searchParams.get("listingIds") || "";

  const daysBack = range === "7d" ? 7 : range === "6m" ? 182 : 30;
  const startDateStr =
    range === "all"
      ? null
      : new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

  const targetUserId = resolveDashboardUserId(session, searchParams);

  // Fetch all listing IDs for this landlord via listing_landlords
  const { data: ll, error: llError } = await supabase
    .from("listing_landlords")
    .select("listing_id")
    .eq("user_id", targetUserId);

  if (llError) {
    return NextResponse.json({ error: llError.message }, { status: 500 });
  }

  const ownedIds = (ll ?? []).map((r) => r.listing_id);

  // Fetch listing details for the dropdown
  let listings = [];
  if (ownedIds.length > 0) {
    const { data: listingRows, error: listingsError } = await supabase
      .from("listings")
      .select("id, address, title")
      .in("id", ownedIds)
      .order("created_at", { ascending: false });

    if (listingsError) {
      return NextResponse.json({ error: listingsError.message }, { status: 500 });
    }
    listings = listingRows ?? [];
  }

  const allIds = listings.map((l) => l.id);
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
    let query = supabase
      .from("listing_metrics_daily")
      .select("listing_id, metric_type_id, metric_types(name), recorded_date, count")
      .in("listing_id", targetIds)
      .order("recorded_date", { ascending: true });
    if (startDateStr) query = query.gte("recorded_date", startDateStr);
    const { data, error: metricsError } = await query;

    if (metricsError) {
      return NextResponse.json({ error: metricsError.message }, { status: 500 });
    }

    // Map to maintain frontend compatibility: expose metric_type as name string
    metrics = (data ?? []).map((row) => ({
      listing_id: row.listing_id,
      metric_type: row.metric_types?.name ?? null,
      recorded_date: row.recorded_date,
      count: row.count,
    }));
  }

  // Direct contact counts from user_listing_interactions (source of truth — listing_metrics_daily
  // can lag when increment_listing_metric RPC misses older or failed calls)
  const contactTotals = {};
  if (targetIds.length > 0) {
    const { data: contactTypeRow } = await supabase
      .from("interaction_types")
      .select("id")
      .eq("name", "contacted")
      .single();
    if (contactTypeRow?.id) {
      let contactQuery = supabase
        .from("user_listing_interactions")
        .select("listing_id")
        .in("listing_id", targetIds)
        .eq("interaction_type_id", contactTypeRow.id);
      if (startDateStr) contactQuery = contactQuery.gte("created_at", startDateStr);
      const { data: contactRows } = await contactQuery;
      for (const row of contactRows ?? []) {
        contactTotals[row.listing_id] = (contactTotals[row.listing_id] ?? 0) + 1;
      }
    }
  }

  return NextResponse.json({ listings, metrics, contactTotals });
}
