export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { requireDbRole } from "@/lib/userRole";
import { exhibitPreview } from "@/lib/billing/exhibitUnits";
import { cleanRequiredUnits } from "@/lib/billing/coverage";
import { billingErrorResponse, isUuid } from "@/lib/billing/http";
import { BillingError } from "@/lib/billing/errors";
import { isPayerFor } from "@/lib/billing/payerLinks";
import { waitingRequests } from "@/lib/billing/payers";

/*
 * The signing popup's Exhibit A step: each property that can go on the document
 * the landlord is about to sign, with its units, what is covered already and the
 * default whole-building or units choice. Query: listingIds (comma separated, the
 * properties being published; empty from the Payments tab).
 * Answers { kind: "master" | "amendment" | "none", properties: [...] }.
 *
 * @auth landlord (own properties only)
 */

export async function GET(req) {
  const session = await requireDbRole(["landlord"]);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const params = new URL(req.url).searchParams;
    const raw = params.get("listingIds") ?? "";
    const listingIds = raw.split(",").filter((id) => isUuid(id)).slice(0, 200);
    // Units being published right now: { listingId: [unit name] } as JSON.
    let units = null;
    try {
      units = JSON.parse(params.get("units") || "null");
    } catch {
      units = null;
    }
    // A payer previewing the addendum for an account they pay for (accountId): what it asked to publish.
    const accountId = params.get("accountId");
    if (isUuid(accountId) && accountId !== session.user.id) {
      if (!(await isPayerFor(supabase, session.user.id, accountId))) throw new BillingError("not_payer", "You don't pay for that account.", 403);
      const waiting = (await waitingRequests(supabase, accountId)).map((w) => w.listing_id);
      return NextResponse.json(await exhibitPreview(supabase, accountId, { listingIds: waiting, forPayee: true }));
    }
    return NextResponse.json(await exhibitPreview(supabase, session.user.id, { listingIds, requiredUnits: cleanRequiredUnits(units) }));
  } catch (err) {
    return billingErrorResponse(err, "load Exhibit A");
  }
}
