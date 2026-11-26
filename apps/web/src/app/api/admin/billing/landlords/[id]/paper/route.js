export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { adminBillingDb, readOnlyResponse } from "@/lib/billing/adminDb";
import { requireDbRole } from "@/lib/userRole";
import { paperPreview, printPaperAgreement } from "@/lib/billing/paperAgreements";
import { BillingError } from "@/lib/billing/errors";
import { billingErrorResponse, isUuid } from "@/lib/billing/http";

/*
 * Printing a landlord's marketing agreement to sign on paper (Wyatt, 2026-11-17).
 *
 * GET   the property picker: the same Exhibit A choices the landlord sees when
 *       signing in the app, and the company to print (last one they gave)
 * POST  { exhibit: [{ listingId, include, excluded?, wholeBuilding, units }], company }
 *       puts the agreement out on paper and holds the chosen properties.
 *       Answers { id }; the PDF is GET .../paper/{id}/file.
 *
 * @auth admin
 */
async function landlordId(params) {
  const { id } = await params;
  if (!isUuid(id)) throw new BillingError("not_found", "That landlord was not found.", 404);
  return id;
}

export async function GET(req, { params }) {
  const session = await requireDbRole(["super"]);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const billingDb = adminBillingDb(req);
  try {
    return NextResponse.json(await paperPreview(billingDb.db, await landlordId(params)));
  } catch (err) {
    return billingErrorResponse(err, "load the paper agreement properties");
  }
}

export async function POST(req, { params }) {
  const session = await requireDbRole(["super"]);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const billingDb = adminBillingDb(req);
  if (!billingDb.writable) return readOnlyResponse(billingDb);
  try {
    const id = await landlordId(params);
    const body = await req.json().catch(() => ({}));
    if (!Array.isArray(body.exhibit)) throw new BillingError("no_properties", "Choose the properties for Exhibit A.");
    return NextResponse.json(await printPaperAgreement(billingDb.db, { landlordId: id, exhibit: body.exhibit, company: body.company }));
  } catch (err) {
    return billingErrorResponse(err, "print a paper agreement");
  }
}
