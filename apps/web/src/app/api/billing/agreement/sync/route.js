export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { requireDbRole } from "@/lib/userRole";
import { agreementState, agreementView, syncAgreement } from "@/lib/billing/agreements";
import { agreementServices } from "@/lib/billing/agreementServices";
import { billingErrorResponse } from "@/lib/billing/http";

/*
 * Called when the embedded signing page says the landlord finished (or declined):
 * asks Documenso directly instead of waiting for the webhook, then answers the
 * landlord's agreement as the Payments tab shows it.
 *
 * @auth landlord (own agreement only)
 */
export async function POST() {
  const session = await requireDbRole(["landlord"]);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const { documenso, signingAvailable, options } = agreementServices();
    const result = signingAvailable ? await syncAgreement(supabase, documenso, session.user.id, options) : "unchanged";
    const state = await agreementState(supabase, session.user.id);
    return NextResponse.json({ result, agreement: agreementView(state, { signingAvailable }) });
  } catch (err) {
    return billingErrorResponse(err, "sync agreement");
  }
}
