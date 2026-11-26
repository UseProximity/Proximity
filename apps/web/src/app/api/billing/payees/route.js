export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { billingReader } from "@/lib/billing/viewer";
import { billingErrorResponse } from "@/lib/billing/http";
import { payerAccounts } from "@/lib/billing/payers";

/*
 * The landlord accounts the signed-in user pays for (Project B).
 *   GET   { accounts: [{ landlordId, accountName, accountEmail, since, covered,
 *         waiting, needs: "agreement" | "addendum" | null, declined }] }
 * Read only: a signer cannot void what they signed for an account. The landlord
 * revokes them instead (PATCH /api/billing/payer, Wyatt 2026-11-10).
 *
 * @auth landlord (accounts they pay for only)
 */
export async function GET(req) {
  const reader = await billingReader(req);
  if (!reader) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    return NextResponse.json({ accounts: await payerAccounts(supabase, reader.userId) });
  } catch (err) {
    return billingErrorResponse(err, "load accounts you pay for");
  }
}
