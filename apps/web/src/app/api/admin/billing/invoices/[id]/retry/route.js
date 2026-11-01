export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { requireDbRole } from "@/lib/userRole";
import { getStripe } from "@/lib/billing/stripe";
import { retryInvoicePayment } from "@/lib/billing/invoiceAccess";
import { BillingError } from "@/lib/billing/errors";
import { billingErrorResponse, isUuid } from "@/lib/billing/http";

/*
 * An admin retries payment of a failed invoice: one attempt with the landlord's
 * default active payment method, the same as their Pay now button.
 *
 * @auth admin
 */
export async function POST(_req, { params }) {
  const session = await requireDbRole(["super", "admin"]);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const { id } = await params;
    if (!isUuid(id)) throw new BillingError("not_found", "Invoice not found.", 404);
    const result = await retryInvoicePayment(supabase, getStripe(), { invoiceId: id });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return billingErrorResponse(err, "retry invoice payment");
  }
}
