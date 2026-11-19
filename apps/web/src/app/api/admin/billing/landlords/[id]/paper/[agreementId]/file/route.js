export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { adminBillingDb } from "@/lib/billing/adminDb";
import { requireDbRole } from "@/lib/userRole";
import { paperAgreementPdf } from "@/lib/billing/paperAgreements";
import { pdfOrLink, readAgreementFile } from "@/lib/billing/agreementFiles";
import { documensoConfigured } from "@/lib/billing/documenso";
import { documensoClient } from "@/lib/billing/agreementServices";
import { BillingError } from "@/lib/billing/errors";
import { billingErrorResponse, isUuid } from "@/lib/billing/http";

/*
 * The printable PDF of a paper agreement that is out: the agreement with
 * Exhibit A and the company filled in, everything else blank to sign by hand.
 *
 * @auth admin
 */
export async function GET(req, { params }) {
  const session = await requireDbRole(["super"]);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const billingDb = adminBillingDb(req);
  try {
    const { id, agreementId } = await params;
    if (!isUuid(id) || !isUuid(agreementId)) throw new BillingError("not_found", "That paper agreement was not found.", 404);
    const { bytes } = await paperAgreementPdf(billingDb.db, {
      landlordId: id,
      id: agreementId,
      readFile: readAgreementFile,
      documenso: documensoConfigured() ? documensoClient() : null,
    });
    return pdfOrLink(bytes, "marketing-agreement-for-signing.pdf");
  } catch (err) {
    return billingErrorResponse(err, "print a paper agreement");
  }
}
