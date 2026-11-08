export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { adminBillingDb, readOnlyResponse } from "@/lib/billing/adminDb";
import { requireDbRole } from "@/lib/userRole";
import { combinedSignedPdf, pdfOrLink } from "@/lib/billing/agreementFiles";
import { BillingError } from "@/lib/billing/errors";
import { billingErrorResponse, isUuid } from "@/lib/billing/http";

/*
 * A landlord's signed agreement as one PDF: the agreement with its Exhibit A.
 *
 * @auth admin
 */
export async function GET(req, { params }) {
  const session = await requireDbRole(["super"]);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const billingDb = adminBillingDb(req);
  const supabase = billingDb.db;

  try {
    const { id } = await params;
    if (!isUuid(id)) throw new BillingError("not_found", "Agreement not found.", 404);
    const { data, error } = await supabase
      .from("landlord_agreements")
      .select("signed_file_key, signed_exhibit_file_key, exhibit_file_key, agreement_version:agreement_versions!version_id(file_key)")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!data?.signed_file_key) throw new BillingError("not_found", "There is no signed copy on file.", 404);
    const keys = [
      data.signed_file_key && { key: data.signed_file_key, originalKey: data.agreement_version?.file_key ?? null },
      data.signed_exhibit_file_key && { key: data.signed_exhibit_file_key, originalKey: data.exhibit_file_key ?? null },
    ].filter(Boolean);
    return pdfOrLink(await combinedSignedPdf(keys), "marketing-agreement.pdf");
  } catch (err) {
    return billingErrorResponse(err, "open signed agreement");
  }
}
