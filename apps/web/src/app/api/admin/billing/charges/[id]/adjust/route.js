export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { adminBillingDb, readOnlyResponse } from "@/lib/billing/adminDb";
import { requireDbRole } from "@/lib/userRole";
import { getStripe } from "@/lib/billing/stripe";
import { adjustPaidCharge } from "@/lib/billing/adjustments";
import { dollarsToCents } from "@/lib/billing/money";
import { BillingError } from "@/lib/billing/errors";
import { billingErrorResponse, isUuid } from "@/lib/billing/http";
import { billingNotify } from "@/lib/billing/billingNotify";
import { leaseLabel } from "@/lib/billing/chargeDisplay";

/*
 * Tell the landlord about a refund or credit. Best effort: the correction is done
 * either way. Says what happened ("sent", "no_email", "failed") so the admin is
 * told the truth and can follow up by hand.
 */
async function emailLandlord(db, chargeId, adjustment, reason) {
  try {
    const { data: charge } = await db
      .from("charges")
      .select(
        `amount_cents, trigger_type,
         landlord:users!landlord_id(id, name, email),
         listing:listings!listing_id(title, address),
         lease:unit_leases!lease_id(lease_term_months, listing_units!unit_id(name, unit_designator, unit_number, bedrooms)),
         student:users!student_id(name)`
      )
      .eq("id", chargeId)
      .maybeSingle();
    if (!charge?.landlord?.email) return "no_email";
    const sent = await billingNotify().chargeAdjusted({
      landlord: charge.landlord,
      kind: adjustment.kind,
      amountCents: adjustment.amount_cents,
      reason,
      charge: {
        amountCents: charge.amount_cents,
        triggerType: charge.trigger_type,
        listingLabel: charge.listing?.address ?? charge.listing?.title ?? null,
        leaseLabel: leaseLabel(charge.lease),
        studentName: charge.student?.name ?? null,
      },
    });
    return sent === false ? "failed" : "sent";
  } catch (err) {
    console.error("[billing] adjustment email failed:", err?.message);
    return "failed";
  }
}

/*
 * Correct a Paid charge: a Stripe refund to the landlord's payment method (the
 * default) or a credit on their next invoice. The charge itself is never edited;
 * the correction is recorded against it, and the adjustments never add up to more
 * than the charge.
 * Body: { kind: "refund" | "credit", amount (dollars, "25.00"), reason, requestId }
 * `requestId` is made once per attempt by the form, so sending it again is one correction.
 *
 * @auth admin
 */
export async function POST(req, { params }) {
  const session = await requireDbRole(["super"]);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const billingDb = adminBillingDb(req);
  if (!billingDb.writable) return readOnlyResponse(billingDb);
  const supabase = billingDb.db;

  try {
    const { id } = await params;
    if (!isUuid(id)) throw new BillingError("not_found", "Charge not found.", 404);
    const body = await req.json().catch(() => ({}));
    const amountCents = dollarsToCents(body.amount);
    if (!amountCents) throw new BillingError("bad_amount", "Enter an amount in dollars, like 25.00.");

    const adjustment = await adjustPaidCharge(supabase, getStripe(), {
      chargeId: id,
      adminId: session.user.id,
      kind: body.kind,
      amountCents,
      reason: body.reason,
      requestId: body.requestId,
    });
    // Once per correction: a repeated request finds the one already made and says nothing new.
    const email = adjustment.repeated ? "repeated" : await emailLandlord(supabase, id, adjustment, String(body.reason ?? "").trim());
    return NextResponse.json({ ok: true, adjustment, email });
  } catch (err) {
    return billingErrorResponse(err, "adjust charge");
  }
}
