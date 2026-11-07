export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { requireDbRole } from "@/lib/userRole";
import { autopayState, disableAutopay, enableAutopay } from "@/lib/billing/autopay";
import { BillingError } from "@/lib/billing/errors";
import { billingErrorResponse, isUuid } from "@/lib/billing/http";

/*
 * The landlord's autopay.
 *   GET     whether it is on, with which method, and the methods they could pick
 *           (each with the exact authorisation they would agree to)
 *   POST    { paymentMethodId, authorized: true } turns it on, or moves it to
 *           another method. Only the landlord can: there is no admin version.
 *   DELETE  turns it off
 *
 * @auth landlord (own autopay only)
 */
export async function GET() {
  const session = await requireDbRole(["landlord"]);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    return NextResponse.json(await autopayState(supabase, session.user.id));
  } catch (err) {
    return billingErrorResponse(err, "read autopay");
  }
}

export async function POST(req) {
  const session = await requireDbRole(["landlord"]);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const body = (await req.json().catch(() => null)) ?? {};
    if (!isUuid(body.paymentMethodId)) throw new BillingError("not_found", "Payment method not found.", 404);
    await enableAutopay(supabase, {
      userId: session.user.id,
      paymentMethodId: body.paymentMethodId,
      authorized: body.authorized === true,
      userAgent: req.headers.get("user-agent"),
    });
    return NextResponse.json(await autopayState(supabase, session.user.id));
  } catch (err) {
    return billingErrorResponse(err, "turn on autopay");
  }
}

export async function DELETE() {
  const session = await requireDbRole(["landlord"]);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    await disableAutopay(supabase, { userId: session.user.id, reason: "landlord", byId: session.user.id });
    return NextResponse.json(await autopayState(supabase, session.user.id));
  } catch (err) {
    return billingErrorResponse(err, "turn off autopay");
  }
}
