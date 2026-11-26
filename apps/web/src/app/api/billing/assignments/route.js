export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { billingReader } from "@/lib/billing/viewer";
import { billingErrorResponse } from "@/lib/billing/http";
import { assignmentsFor } from "@/lib/billing/authorizedPayers";

/*
 * Who signs and who pays for the signed-in landlord's account and each of its
 * listings (Wyatt, 2026-11-25), for the "Who signs and who pays" card.
 *   GET  { account: { signer, payer }, listings: [{ listingId, address, live,
 *        draft, covered, ownSigner, ownPayer, signs, pays }] }
 *
 * @auth landlord (own account only)
 */
export async function GET(req) {
  const reader = await billingReader(req);
  if (!reader) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    return NextResponse.json(await assignmentsFor(supabase, reader.userId));
  } catch (err) {
    return billingErrorResponse(err, "load who signs and pays");
  }
}
