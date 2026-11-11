export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { adminBillingDb, readOnlyResponse } from "@/lib/billing/adminDb";
import { requireDbRole } from "@/lib/userRole";
import { getBaseUrl } from "@/lib/email";
import { createCharge } from "@/lib/billing/charges";
import { adminConfirmCharge, getAdminChargeView } from "@/lib/billing/adminReview";
import { landlordProperties } from "@/lib/billing/adminLandlords";
import { sendChargeCreatedEmail } from "@/lib/billing/billingEmails";
import { dollarsToCents } from "@/lib/billing/money";
import { BillingError } from "@/lib/billing/errors";
import { billingErrorResponse, isUuid } from "@/lib/billing/http";
import { CHARGE_REASONS } from "@/lib/billing/constants";

/*
 * A super admin puts a real charge on a landlord's account (Wyatt, 2026-11-08:
 * charges are made by hand until they are created automatically). Works on
 * production. Creating it counts as confirming it: the charge goes straight to
 * Pending, the landlord's 7 day review starts, and they are emailed to review it.
 * If they do nothing it is approved when the review ends and goes on the next
 * monthly invoice, like any other charge.
 *
 * Body: { landlordId, amount (dollars), reason (a CHARGE_REASONS key),
 *         description?, listingId?, leaseId?, signedRent? (dollars), commissionRate? (percent) }
 *
 * The property and lease must be the landlord's. The same charge (landlord,
 * amount, property, lease) made twice within two minutes is refused, so a double
 * click never bills twice.
 *
 * @auth admin
 */
const DUPLICATE_WINDOW_MS = 2 * 60 * 1000;

export async function POST(req) {
  const session = await requireDbRole(["super"]);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const billingDb = adminBillingDb(req);
  if (!billingDb.writable) return readOnlyResponse(billingDb);
  const supabase = billingDb.db;

  try {
    const body = await req.json().catch(() => ({}));
    if (!isUuid(body.landlordId)) throw new BillingError("bad_landlord", "Choose a landlord.");
    const amountCents = dollarsToCents(body.amount);
    if (!amountCents) throw new BillingError("bad_amount", "Enter the amount in dollars, like 450.00.");
    if (!Object.hasOwn(CHARGE_REASONS, body.reason)) throw new BillingError("bad_reason", "Choose what the charge is for.");
    const description = String(body.description ?? "").trim().slice(0, 500);
    if (body.reason === "other" && !description) {
      throw new BillingError("description_required", "Say what the charge is for. The landlord sees this.");
    }

    const listingId = body.listingId || null;
    const leaseId = body.leaseId || null;
    if (listingId || leaseId) {
      if ((listingId && !isUuid(listingId)) || (leaseId && !isUuid(leaseId))) {
        throw new BillingError("bad_reference", "That property or lease was not found.");
      }
      const property = (await landlordProperties(supabase, body.landlordId)).find((p) => p.listingId === listingId);
      if (!property) throw new BillingError("bad_property", "That property is not this landlord's.");
      if (leaseId && !property.leases.some((l) => l.leaseId === leaseId)) {
        throw new BillingError("bad_lease", "That lease is not on this property.");
      }
    }

    const signedRentCents = body.signedRent != null && body.signedRent !== "" ? dollarsToCents(body.signedRent) : null;
    if (body.signedRent && !signedRentCents) throw new BillingError("bad_rent", "Enter the signed rent in dollars, like 1500.00.");
    const rate = body.commissionRate != null && body.commissionRate !== "" ? Number(body.commissionRate) : null;
    if (rate != null && !(Number.isFinite(rate) && rate > 0 && rate <= 100)) {
      throw new BillingError("bad_rate", "Enter the commission rate as a percent between 0 and 100.");
    }

    let dupe = supabase
      .from("charges")
      .select("id")
      .eq("landlord_id", body.landlordId)
      .eq("amount_cents", amountCents)
      .eq("created_by_type", "admin")
      .gte("created_at", new Date(Date.now() - DUPLICATE_WINDOW_MS).toISOString())
      .limit(1);
    dupe = listingId ? dupe.eq("listing_id", listingId) : dupe.is("listing_id", null);
    dupe = leaseId ? dupe.eq("lease_id", leaseId) : dupe.is("lease_id", null);
    const { data: recent, error: dupeError } = await dupe;
    if (dupeError) throw dupeError;
    if (recent?.length) {
      throw new BillingError("duplicate", "You just made this same charge. Check the landlord's charges before making it again.", 409);
    }

    const charge = await createCharge(supabase, {
      landlordId: body.landlordId,
      amountCents,
      triggerType: body.reason,
      description,
      listingId,
      leaseId,
      signedRentCents,
      commissionRatePercent: rate,
      createdByType: "admin",
      createdById: session.user.id,
    });

    // Created is confirmed: start the landlord's review. Should that fail, the
    // charge waits under To confirm instead, and no email goes out.
    try {
      await adminConfirmCharge(supabase, { chargeId: charge.id, adminId: session.user.id });
    } catch (err) {
      console.error("billing: could not start the review of a new charge", err);
      return NextResponse.json({ ok: true, id: charge.id, status: "unconfirmed", emailed: false });
    }

    // The charge stands either way; an email problem must not undo it.
    let emailed = false;
    try {
      const view = await getAdminChargeView(supabase, charge.id);
      if (view.landlord.email) {
        emailed = await sendChargeCreatedEmail(
          { id: view.landlord.id, email: view.landlord.email, name: view.landlord.name },
          {
            charge: view,
            reviewEndsAt: view.reviewEndsAt,
            paymentsUrl: `${getBaseUrl()}/dashboard/landlord?tab=billing`,
          }
        );
      }
    } catch (emailErr) {
      console.error("billing: new charge email failed", emailErr);
    }
    return NextResponse.json({ ok: true, id: charge.id, status: "pending", emailed });
  } catch (err) {
    return billingErrorResponse(err, "create charge");
  }
}
