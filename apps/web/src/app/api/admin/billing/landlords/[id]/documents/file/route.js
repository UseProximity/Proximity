export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { adminBillingDb, readOnlyResponse } from "@/lib/billing/adminDb";
import { requireDbRole } from "@/lib/userRole";
import { documentParts } from "@/lib/billing/agreements";
import { combinedSignedPdf, pdfResponse } from "@/lib/billing/agreementFiles";
import { BillingError } from "@/lib/billing/errors";
import { billingErrorResponse, isUuid } from "@/lib/billing/http";

/*
 * A five minute link to one of a landlord's signed files, for the admin.
 * Query: kind=master|amendment, id (the document). Answers the document as one
 * PDF: the agreement with its Exhibit A, or an amendment with its before and after.
 * The document must belong to the landlord in the path.
 *
 * @auth admin
 */

export async function GET(req, { params }) {
  const session = await requireDbRole(["super"]);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const billingDb = adminBillingDb(req);
  const supabase = billingDb.db;
  try {
    const { id: landlordId } = await params;
    const q = new URL(req.url).searchParams;
    const docId = q.get("id");
    if (!isUuid(landlordId) || (docId && !isUuid(docId))) throw new BillingError("not_found", "That document was not found.", 404);
    const kind = q.get("kind") === "amendment" ? "amendment" : "master";
    const keys = await documentParts(supabase, { userId: landlordId, kind, id: docId });
    if (!keys.length) throw new BillingError("not_found", "There is no signed copy on file.", 404);
    return pdfResponse(await combinedSignedPdf(keys), kind === "amendment" ? "exhibit-a-amendment.pdf" : "marketing-agreement.pdf");
  } catch (err) {
    return billingErrorResponse(err, "open a landlord's signed document");
  }
}
