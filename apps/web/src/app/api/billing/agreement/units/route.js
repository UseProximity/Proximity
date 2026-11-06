export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { requireDbRole } from "@/lib/userRole";
import { addUnit, renameUnit } from "@/lib/billing/exhibitUnits";
import { BillingError } from "@/lib/billing/errors";
import { billingErrorResponse } from "@/lib/billing/http";

/*
 * Units named on the signing popup's Exhibit A step (lib/billing/exhibitUnits.js).
 *   POST  { listingId, name, bedrooms, bathrooms }  adds an unpublished unit with no leases
 *   PATCH { unitId, name }                          renames a unit (or floor plan)
 * Answers { unit: { id, label } }. Only the landlord's own properties and units.
 *
 * @auth landlord (own properties only)
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req) {
  const session = await requireDbRole(["landlord"]);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const body = await req.json().catch(() => ({}));
    if (!UUID.test(String(body.listingId ?? ""))) throw new BillingError("not_found", "That property was not found.", 404);
    const unit = await addUnit(supabase, session.user.id, body);
    return NextResponse.json({ unit });
  } catch (err) {
    return billingErrorResponse(err, "add a unit");
  }
}

export async function PATCH(req) {
  const session = await requireDbRole(["landlord"]);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const body = await req.json().catch(() => ({}));
    if (!UUID.test(String(body.unitId ?? ""))) throw new BillingError("not_found", "That unit was not found.", 404);
    const unit = await renameUnit(supabase, session.user.id, body);
    return NextResponse.json({ unit });
  } catch (err) {
    return billingErrorResponse(err, "rename a unit");
  }
}
