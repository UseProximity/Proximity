export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { requireDbRole } from "@/lib/userRole";
import { startSigning } from "@/lib/billing/agreements";
import { agreementServices } from "@/lib/billing/agreementServices";
import { documensoHost } from "@/lib/billing/documenso";
import { BillingError } from "@/lib/billing/errors";
import { billingErrorResponse } from "@/lib/billing/http";

/*
 * Start signing the commission agreement inside the Payments tab.
 * Body: { signerTitle, authorized: true }
 * Answers { token, host } for Documenso's embedded signing page, or
 * { alreadySigned: true }. A copy already in progress is reused.
 *
 * @auth landlord (own agreement only)
 */
export async function POST(req) {
  const session = await requireDbRole(["landlord"]);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const body = await req.json().catch(() => ({}));
    const { documenso, signingAvailable, options } = agreementServices();
    if (!signingAvailable) {
      throw new BillingError("not_available", "Signing in the app is not set up yet. Email info@useproximity.org and we will send you the agreement.", 503);
    }
    const { data: user, error } = await supabase.from("users").select("id, name, email").eq("id", session.user.id).single();
    if (error) throw error;
    const result = await startSigning(supabase, documenso, {
      user,
      signerTitle: body.signerTitle,
      authorized: body.authorized === true,
      ...options,
    });
    return NextResponse.json(result.token ? { token: result.token, host: documensoHost() } : result);
  } catch (err) {
    if (err?.name === "DocumensoError") {
      console.error("billing: start signing failed", err.message);
      return NextResponse.json({ error: "We could not open the agreement right now. Please try again in a few minutes." }, { status: 502 });
    }
    return billingErrorResponse(err, "start signing");
  }
}
