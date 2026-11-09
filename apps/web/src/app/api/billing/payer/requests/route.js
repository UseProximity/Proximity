export const dynamic = "force-dynamic";

import { NextResponse, after } from "next/server";
import supabase from "@/lib/supabase";
import { requireDbRole } from "@/lib/userRole";
import { agreementServices } from "@/lib/billing/agreementServices";
import { billingErrorResponse, isUuid } from "@/lib/billing/http";
import { isPropertyOwner } from "@/lib/listings/ownership";
import { BillingError } from "@/lib/billing/errors";
import { landlordPayerView, requestPayerCoverage } from "@/lib/billing/payers";
import { sendPayerRequest } from "@/lib/billing/payerServices";

/*
 * The landlord confirmed that what they are publishing goes to their payer
 * (Project B): { listingIds }. Each waits as a draft on the addendum still
 * waiting for the payer, or starts a new one (the payer is emailed then, once).
 * It goes live as soon as the payer signs, and the landlord is emailed.
 *
 * @auth landlord (own listings only)
 */
export async function POST(req) {
  const session = await requireDbRole(["landlord"]);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const body = await req.json().catch(() => ({}));
    const ids = Array.isArray(body.listingIds) ? [...new Set(body.listingIds.filter(isUuid))].slice(0, 100) : [];
    // Only properties the landlord has a stake in: their own, or one they list a unit in.
    const own = [];
    for (const id of ids) {
      if (await isPropertyOwner(session.user.id, id)) own.push(id);
      else {
        const { data } = await supabase.from("unit_leases").select("id, listing_units!inner(listing_id)").eq("owner_id", session.user.id).eq("listing_units.listing_id", id).is("deleted_at", null).limit(1);
        if (data?.length) own.push(id);
      }
    }
    if (!own.length) throw new BillingError("nothing_to_add", "Choose your own listings to send.");
    const { documenso } = agreementServices();
    const { firstRequest } = await requestPayerCoverage(supabase, documenso, { landlordId: session.user.id, listingIds: own });
    if (firstRequest) {
      const { data: listings } = await supabase.from("listings").select("address").in("id", own);
      const addresses = (listings ?? []).map((l) => l.address).filter(Boolean);
      after(() => sendPayerRequest({ landlordId: session.user.id, addresses }).catch((err) => console.error("billing: payer request email failed", err?.message)));
    }
    return NextResponse.json({ payer: await landlordPayerView(supabase, session.user.id) });
  } catch (err) {
    return billingErrorResponse(err, "send to payer");
  }
}
