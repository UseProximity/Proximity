export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { requireImporter } from "../../_auth";
import { loadDashboardListing } from "@/lib/users/dashboardUser";

/*
 * One listing in the dashboard's shape, for the workspace's editor, plus the
 * open changes a read proposed for it (an existing listing's tab).
 * @auth landlord
 */
export async function GET(req, { params }) {
  const gate = await requireImporter();
  if (gate.res) return gate.res;
  const { listingId } = await params;
  const listing = await loadDashboardListing({ listingId, userId: gate.userId });
  if (!listing) return NextResponse.json({ error: "No such listing." }, { status: 404 });
  const { data: events } = await supabase
    .from("listing_source_events")
    .select("id, kind, unit_key, field, old_value, new_value, detail, status, applied, created_at")
    .eq("listing_id", listingId)
    .eq("status", "open")
    .order("created_at", { ascending: true });
  return NextResponse.json({ listing, proposed: (events ?? []).filter((e) => e.detail?.op && e.detail.op !== "none"), flagged: (events ?? []).filter((e) => !e.detail?.op || e.detail.op === "none") });
}
