export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { adminBillingDb, readOnlyResponse } from "@/lib/billing/adminDb";
import { requireDbRole } from "@/lib/userRole";
import { ACTIVE_STATUSES, CLOSED_STATUSES, countByStatus, listForAdmin } from "@/lib/billing/changeRequests";
import { billingErrorResponse } from "@/lib/billing/http";

/*
 * Landlords' requests to change the commission agreement, for the admin
 * dashboard (Billing, Change requests).
 *
 * GET ?status=open|answered|accepted|resolved|declined|withdrawn  (optional)
 *     -> { requests: [...with landlord and thread], counts: { open, answered, accepted } }
 * GET ?summary=1  -> { counts } only, for the tab badge
 *
 * @auth admin
 */
export async function GET(req) {
  const session = await requireDbRole(["super"]);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const billingDb = adminBillingDb(req);
  const supabase = billingDb.db;
  try {
    const url = new URL(req.url);
    if (url.searchParams.get("summary")) return NextResponse.json({ counts: await countByStatus(supabase) });
    const status = url.searchParams.get("status");
    const valid = [...ACTIVE_STATUSES, ...CLOSED_STATUSES].includes(status) ? status : null;
    return NextResponse.json(await listForAdmin(supabase, { status: valid }));
  } catch (err) {
    return billingErrorResponse(err, "list change requests");
  }
}
