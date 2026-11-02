export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { requireDbRole } from "@/lib/userRole";
import { getSignedAgreement } from "@/lib/billing/agreements";
import { signedAgreementUrl } from "@/lib/billing/agreementFiles";
import { BillingError } from "@/lib/billing/errors";
import { billingErrorResponse } from "@/lib/billing/http";

/*
 * A five minute download link for the landlord's own current signed agreement
 * (signed in the app, or recorded by an admin with the PDF). Only their own file
 * is ever returned.
 *
 * @auth landlord (own agreement only)
 */
export async function GET() {
  const session = await requireDbRole(["landlord"]);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const agreement = await getSignedAgreement(supabase, session.user.id);
    if (!agreement?.signed_file_key) {
      throw new BillingError("not_found", "There is no signed copy on file.", 404);
    }
    return NextResponse.json({ url: await signedAgreementUrl(agreement.signed_file_key) });
  } catch (err) {
    return billingErrorResponse(err, "open signed agreement");
  }
}
