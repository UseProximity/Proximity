export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { adminBillingDb, readOnlyResponse } from "@/lib/billing/adminDb";
import { requireDbRole } from "@/lib/userRole";
import { BillingError } from "@/lib/billing/errors";
import { billingErrorResponse, isUuid } from "@/lib/billing/http";
import { disclosureHistory } from "@/lib/users/licenseDisclosure";

/*
 * One landlord's real estate license disclosure history for the admin
 * dashboard: every answer saved from their Profile and every confirmation given
 * right before signing, newest first, including the private license number.
 * Read-only.
 *
 * @auth admin
 */
export async function GET(req, { params }) {
  const session = await requireDbRole(["super", "admin"]);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const billingDb = adminBillingDb(req);
  const supabase = billingDb.db;
  try {
    const { id } = await params;
    if (!isUuid(id)) throw new BillingError("not_found", "That landlord was not found.", 404);
    return NextResponse.json({ history: await disclosureHistory(supabase, id) });
  } catch (err) {
    return billingErrorResponse(err, "list a landlord's license disclosures");
  }
}
