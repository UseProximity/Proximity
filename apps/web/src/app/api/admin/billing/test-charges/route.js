export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { isProdData } from "@/lib/appEnv";
import { requireDbRole } from "@/lib/userRole";
import { emailMatchPattern, normalizeEmail } from "@/lib/auth/email";
import { createCharge, transitionCharge } from "@/lib/billing/charges";
import { dollarsToCents } from "@/lib/billing/money";
import { BillingError } from "@/lib/billing/errors";
import { billingErrorResponse, isUuid } from "@/lib/billing/http";

/*
 * Admin "create test charge" tool: makes a charge on a landlord account so the
 * dashboard, billing run, contest flow and overdue withdrawal can be exercised
 * before the Triggering project ships (nothing else creates charges yet).
 *
 * Off by default on the real site: it refuses on production, because a charge
 * made here would be collected from a real landlord. Staging and local run on
 * the dev database with sandbox Stripe keys, where it is safe. Charges it makes
 * are flagged is_test. Always uses the app's own database (not the dashboard's
 * dev/prod switch), so a test charge can never land in the wrong environment.
 *
 * Body: { landlordEmail, amount (dollars, "25.00"), triggerType?, description?,
 *         listingId?, leaseId?, studentId?, signedRent? (dollars), commissionRate?
 *         (percent), confirm? (move straight to Pending) }
 *
 * @auth admin
 */
export async function POST(req) {
  const session = await requireDbRole(["super", "admin"]);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (isProdData()) {
    return NextResponse.json({ error: "Test charges are disabled on production." }, { status: 403 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const amountCents = dollarsToCents(body.amount);
    if (!amountCents) throw new BillingError("bad_amount", "Enter an amount in dollars, like 25.00.");

    const { data: landlord, error } = await supabase
      .from("users")
      .select("id")
      .ilike("email", emailMatchPattern(normalizeEmail(body.landlordEmail)))
      .is("deleted_at", null)
      .maybeSingle();
    if (error) throw error;
    if (!landlord) throw new BillingError("bad_landlord", "No account with that email.", 404);

    for (const key of ["listingId", "leaseId", "studentId"]) {
      if (body[key] && !isUuid(body[key])) throw new BillingError("bad_reference", `${key} is not a valid id.`);
    }

    const signedRentCents = body.signedRent != null && body.signedRent !== "" ? dollarsToCents(body.signedRent) : null;
    if (body.signedRent && !signedRentCents) throw new BillingError("bad_rent", "Enter the signed rent in dollars, like 1500.00.");
    const rate = body.commissionRate != null && body.commissionRate !== "" ? Number(body.commissionRate) : null;
    if (rate != null && !(Number.isFinite(rate) && rate > 0 && rate <= 100)) {
      throw new BillingError("bad_rate", "Enter the commission rate as a percent between 0 and 100.");
    }

    const charge = await createCharge(supabase, {
      landlordId: landlord.id,
      amountCents,
      triggerType: body.triggerType || "test_charge",
      description: body.description,
      listingId: body.listingId || null,
      leaseId: body.leaseId || null,
      studentId: body.studentId || null,
      signedRentCents,
      commissionRatePercent: rate,
      createdByType: "admin",
      createdById: session.user.id,
      isTest: true,
    });

    let status = charge.status;
    if (body.confirm) {
      const confirmed = await transitionCharge(supabase, {
        chargeId: charge.id,
        expectedFrom: "unconfirmed",
        to: "pending",
        actorType: "admin",
        actorUserId: session.user.id,
        note: "Confirmed from the test charge tool",
      });
      status = confirmed.status;
    }
    return NextResponse.json({ ok: true, id: charge.id, status });
  } catch (err) {
    return billingErrorResponse(err, "create test charge");
  }
}
