export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { adminBillingDb } from "@/lib/billing/adminDb";
import { requireDbRole } from "@/lib/userRole";
import { billingErrorResponse } from "@/lib/billing/http";
import { lookupPayer } from "@/lib/billing/payers";

/*
 * Who an email belongs to, before an admin assigns it as a payer (Project B):
 * an existing landlord or billing account, nobody (an account will be made), or
 * an account that can't pay. GET ?email=...&role=signer|payer
 *
 * @auth super
 */
export async function GET(req) {
  const session = await requireDbRole(["super"]);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const email = new URL(req.url).searchParams.get("email") ?? "";
    // ?role=payer checks the authorized payer's rules, not the signer's.
    const role = new URL(req.url).searchParams.get("role") === "payer" ? "payer" : "signer";
    return NextResponse.json(await lookupPayer(adminBillingDb(req).db, email, { role }));
  } catch (err) {
    return billingErrorResponse(err, "look up payer");
  }
}
