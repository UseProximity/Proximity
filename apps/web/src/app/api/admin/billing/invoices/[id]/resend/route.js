export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { adminBillingDb, readOnlyResponse } from "@/lib/billing/adminDb";
import { requireDbRole } from "@/lib/userRole";
import { resendInvoiceEmail } from "@/lib/billing/invoiceAccess";
import { billingNotify } from "@/lib/billing/billingNotify";
import { BillingError } from "@/lib/billing/errors";
import { billingErrorResponse, isUuid } from "@/lib/billing/http";

/*
 * An admin re-sends an unpaid invoice's email (summary, due date, Pay now, and
 * the autopay date if one is coming). Admins never charge a landlord: this
 * replaced "Retry payment" (decisions of 2026-11-04). Off production the email
 * goes to the test inbox, like every email.
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
    if (!isUuid(id)) throw new BillingError("not_found", "Invoice not found.", 404);
    const result = await resendInvoiceEmail(supabase, { invoiceId: id, notify: billingNotify() });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return billingErrorResponse(err, "resend invoice email");
  }
}
