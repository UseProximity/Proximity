export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { requireDbRole } from "@/lib/userRole";
import { signedAgreementUrl } from "@/lib/billing/agreementFiles";
import { BillingError } from "@/lib/billing/errors";
import { billingErrorResponse, isUuid } from "@/lib/billing/http";

/*
 * A five minute download link for a landlord's signed agreement PDF.
 *
 * @auth admin
 */
export async function GET(_req, { params }) {
  const session = await requireDbRole(["super", "admin"]);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const { id } = await params;
    if (!isUuid(id)) throw new BillingError("not_found", "Agreement not found.", 404);
    const { data, error } = await supabase
      .from("landlord_agreements")
      .select("signed_file_key")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!data?.signed_file_key) throw new BillingError("not_found", "There is no signed copy on file.", 404);
    return NextResponse.json({ url: await signedAgreementUrl(data.signed_file_key) });
  } catch (err) {
    return billingErrorResponse(err, "open signed agreement");
  }
}
