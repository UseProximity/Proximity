export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { requireDbRole } from "@/lib/userRole";
import { withdrawExcluded } from "@/lib/billing/exhibitUnits";
import { billingErrorResponse } from "@/lib/billing/http";

/*
 * The signing popup's Exhibit A step, on Continue: live properties the landlord
 * left off come off the site (lib/billing/exhibitUnits.js withdrawExcluded).
 *   POST { listingIds, requestedIds }  ->  { withdrawn, listingIds }
 * Only the landlord's own offerings are touched.
 *
 * @auth landlord (own offerings only)
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuids = (v) => (Array.isArray(v) ? v.filter((x) => UUID.test(String(x))).slice(0, 500) : []);

export async function POST(req) {
  const session = await requireDbRole(["landlord"]);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const body = await req.json().catch(() => ({}));
    const result = await withdrawExcluded(supabase, session.user.id, { listingIds: uuids(body.listingIds), requestedIds: uuids(body.requestedIds) });
    return NextResponse.json(result);
  } catch (err) {
    return billingErrorResponse(err, "take properties off the site");
  }
}
