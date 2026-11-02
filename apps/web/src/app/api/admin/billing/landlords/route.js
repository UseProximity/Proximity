export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { requireDbRole } from "@/lib/userRole";
import { bulkAudience, loadLandlordOverview } from "@/lib/billing/landlordOverview";
import { billingErrorResponse } from "@/lib/billing/http";

/*
 * Every landlord's commission agreement, payment setup, unpaid invoices and
 * whether they can publish, for the admin dashboard.
 * Query: filter (all | unsigned | needs_resign | in_progress | no_method | blocked
 * | live), search (name or email).
 *
 * @auth admin
 */
export async function GET(req) {
  const session = await requireDbRole(["super", "admin"]);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const url = new URL(req.url);
    const filter = url.searchParams.get("filter") || "all";
    const search = url.searchParams.get("search") || "";
    const { allRows, ...overview } = await loadLandlordOverview(supabase, { filter, search });
    return NextResponse.json({ ...overview, bulkAudienceCount: bulkAudience(allRows).length });
  } catch (err) {
    return billingErrorResponse(err, "load landlord overview");
  }
}
