export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { adminBillingDb, readOnlyResponse } from "@/lib/billing/adminDb";
import { requireDbRole } from "@/lib/userRole";
import { AGREEMENT_REQUIRED, PAYMENT_METHOD_REQUIRED, getGateSettings } from "@/lib/billing/listingGate";
import { setBillingSetting } from "@/lib/billing/settings";
import { BillingError } from "@/lib/billing/errors";
import { billingErrorResponse } from "@/lib/billing/http";

/*
 * The listing gate's two switches. Both are off by default so the code can ship
 * before landlords have been told and had time to enrol; turn them on at launch.
 *
 * GET reads them. PUT { requirePaymentMethod?: boolean, requireAgreement?: boolean }
 * changes whichever are given.
 *
 * @auth admin
 */
export async function GET(req) {
  const session = await requireDbRole(["super", "admin"]);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const billingDb = adminBillingDb(req);
  const supabase = billingDb.db;
  try {
    return NextResponse.json(await getGateSettings(supabase));
  } catch (err) {
    return billingErrorResponse(err, "read gate settings");
  }
}

export async function PUT(req) {
  const session = await requireDbRole(["super", "admin"]);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const billingDb = adminBillingDb(req);
  if (!billingDb.writable) return readOnlyResponse(billingDb);
  const supabase = billingDb.db;
  try {
    const body = await req.json().catch(() => ({}));
    const changes = [
      ["requirePaymentMethod", PAYMENT_METHOD_REQUIRED],
      ["requireAgreement", AGREEMENT_REQUIRED],
    ].filter(([field]) => field in body);
    if (!changes.length) throw new BillingError("bad_value", "Nothing to change.");
    for (const [field, key] of changes) {
      if (typeof body[field] !== "boolean") throw new BillingError("bad_value", `${field} must be true or false.`);
    }
    for (const [field, key] of changes) await setBillingSetting(supabase, key, body[field], session.user.id);
    return NextResponse.json(await getGateSettings(supabase));
  } catch (err) {
    return billingErrorResponse(err, "change gate settings");
  }
}
