export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { adminBillingDb } from "@/lib/billing/adminDb";
import { requireDbRole } from "@/lib/userRole";
import { BillingError } from "@/lib/billing/errors";
import { billingErrorResponse, isUuid } from "@/lib/billing/http";
import { assignmentsFor } from "@/lib/billing/authorizedPayers";

/*
 * Who signs and who pays for one landlord's account and each of its listings
 * (Wyatt, 2026-11-25), for the admin's "Signers and payers" panel on a landlord
 * row. GET ?landlordId=...
 * Answers { account: { signer, payer }, listings: [{ listingId, address, live,
 * draft, covered, ownSigner, ownPayer, signs, pays }] }.
 *
 * @auth super
 */
export async function GET(req) {
  const session = await requireDbRole(["super"]);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const landlordId = new URL(req.url).searchParams.get("landlordId");
    if (!isUuid(landlordId)) throw new BillingError("bad_landlord", "Choose a landlord.");
    return NextResponse.json(await assignmentsFor(adminBillingDb(req).db, landlordId));
  } catch (err) {
    return billingErrorResponse(err, "list who signs and pays");
  }
}
