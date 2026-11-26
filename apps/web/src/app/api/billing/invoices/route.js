export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { billingReader } from "@/lib/billing/viewer";
import { listInvoicesForLandlord } from "@/lib/billing/invoiceAccess";
import { billingErrorResponse } from "@/lib/billing/http";

/*
 * The signed-in landlord's monthly invoices, newest first, with their status, the
 * link to Stripe's invoice PDF and hosted page, and whether Pay now is offered.
 *
 * @auth landlord (own invoices only)
 */
export async function GET(req) {
  const reader = await billingReader(req);
  if (!reader) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    return NextResponse.json({ invoices: await listInvoicesForLandlord(supabase, reader.userId) });
  } catch (err) {
    return billingErrorResponse(err, "list invoices");
  }
}
