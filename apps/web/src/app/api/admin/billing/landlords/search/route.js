export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { adminBillingDb } from "@/lib/billing/adminDb";
import { requireDbRole } from "@/lib/userRole";
import { landlordProperties, searchLandlords } from "@/lib/billing/adminLandlords";
import { BillingError } from "@/lib/billing/errors";
import { billingErrorResponse, isUuid } from "@/lib/billing/http";

/*
 * Picking one landlord in the admin billing tools.
 *   GET ?q=jane              up to 20 landlord accounts matching a name, email or company
 *   GET ?landlordId=<uuid>   that landlord's properties, each with the leases they own on it
 *
 * Read-only, so it answers for either database on the dashboard's dev/prod switch.
 *
 * @auth admin
 */
export async function GET(req) {
  const session = await requireDbRole(["super"]);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { db } = adminBillingDb(req);
  try {
    const url = new URL(req.url);
    const landlordId = url.searchParams.get("landlordId");
    if (landlordId) {
      if (!isUuid(landlordId)) throw new BillingError("bad_landlord", "Choose a landlord.");
      return NextResponse.json({ properties: await landlordProperties(db, landlordId) });
    }
    return NextResponse.json({ landlords: await searchLandlords(db, url.searchParams.get("q")) });
  } catch (err) {
    return billingErrorResponse(err, "search landlords");
  }
}
