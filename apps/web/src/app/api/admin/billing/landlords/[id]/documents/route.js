export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { requireDbRole } from "@/lib/userRole";
import { listAgreementDocuments } from "@/lib/billing/agreements";
import { BillingError } from "@/lib/billing/errors";
import { billingErrorResponse } from "@/lib/billing/http";

/*
 * One landlord's agreement history for the admin dashboard: every master
 * agreement and Exhibit A amendment, signed or not, with the properties each
 * listed (and, for an amendment, the list before it) and how it ended.
 *
 * @auth admin
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_req, { params }) {
  const session = await requireDbRole(["super", "admin"]);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const { id } = await params;
    if (!UUID.test(id)) throw new BillingError("not_found", "That landlord was not found.", 404);
    return NextResponse.json({ documents: await listAgreementDocuments(supabase, id) });
  } catch (err) {
    return billingErrorResponse(err, "list a landlord's agreement documents");
  }
}
