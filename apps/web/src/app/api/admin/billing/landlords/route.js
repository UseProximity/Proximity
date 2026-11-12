export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { adminBillingDb, readOnlyResponse } from "@/lib/billing/adminDb";
import { requireDbRole } from "@/lib/userRole";
import { bulkAudience, loadLandlordOverview } from "@/lib/billing/landlordOverview";
import { billingErrorResponse } from "@/lib/billing/http";

/*
 * Every landlord's commission agreement, payment setup, unpaid invoices and
 * whether they can publish, for the admin dashboard.
 * Query: filter (all | unsigned | needs_resign | in_progress | no_method | blocked
 * | live | uncovered | review), search (name or email).
 * Also the number of live offerings, across every landlord, on a property their
 * agreement does not cover.
 *
 * @auth admin
 */
export async function GET(req) {
  const session = await requireDbRole(["super"]);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const billingDb = adminBillingDb(req);
  const supabase = billingDb.db;
  try {
    const url = new URL(req.url);
    const filter = url.searchParams.get("filter") || "all";
    const search = url.searchParams.get("search") || "";
    const { allRows, ...overview } = await loadLandlordOverview(supabase, { filter, search });
    return NextResponse.json({
      ...overview,
      bulkAudienceCount: bulkAudience(allRows).length,
      uncoveredOfferingsTotal: allRows.reduce((n, r) => n + (r.coverage?.uncoveredOfferings ?? 0), 0),
    });
  } catch (err) {
    return billingErrorResponse(err, "load landlord overview");
  }
}
