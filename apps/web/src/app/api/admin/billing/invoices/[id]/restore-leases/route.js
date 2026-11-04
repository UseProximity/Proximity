export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { requireDbRole } from "@/lib/userRole";
import { restoreWithdrawnLeases } from "@/lib/billing/overdueJob";
import { BillingError } from "@/lib/billing/errors";
import { billingErrorResponse, isUuid } from "@/lib/billing/http";

/*
 * An admin puts back the leases the overdue job withdrew for an invoice, once it
 * is settled. Only leases still in the withdrawn state are restored; one the
 * landlord republished or changed since is left alone.
 *
 * @auth admin
 */
export async function POST(_req, { params }) {
  const session = await requireDbRole(["super", "admin"]);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const { id } = await params;
    if (!isUuid(id)) throw new BillingError("not_found", "Invoice not found.", 404);
    const result = await restoreWithdrawnLeases(supabase, { invoiceId: id, adminId: session.user.id });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return billingErrorResponse(err, "restore leases");
  }
}
