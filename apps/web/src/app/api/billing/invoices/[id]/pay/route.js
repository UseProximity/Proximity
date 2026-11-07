export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { requireDbRole } from "@/lib/userRole";
import { getStripe } from "@/lib/billing/stripe";
import { retryInvoicePayment } from "@/lib/billing/invoiceAccess";
import { BillingError } from "@/lib/billing/errors";
import { billingErrorResponse, isUuid } from "@/lib/billing/http";

/*
 * Pay now / Retry payment: one attempt to pay the landlord's open or failed
 * invoice with their default active payment method. Nothing retries on its own,
 * so this is the landlord pressing the button. The result (paid, failed, or an
 * ACH payment settling) arrives by webhook; a decline is returned right away.
 * To use a different method the landlord pays from the invoice's hosted page.
 *
 * @auth landlord (own invoices only)
 */
export async function POST(_req, { params }) {
  const session = await requireDbRole(["landlord"]);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const { id } = await params;
    if (!isUuid(id)) throw new BillingError("not_found", "Invoice not found.", 404);
    const result = await retryInvoicePayment(supabase, getStripe(), { invoiceId: id, landlordId: session.user.id });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return billingErrorResponse(err, "pay invoice");
  }
}
