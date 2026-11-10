export const dynamic = "force-dynamic";

import { NextResponse, after } from "next/server";
import { getBaseUrl } from "@/lib/email";
import { sendPayeeVoidedEmail } from "@/lib/billing/billingEmails";
import supabase from "@/lib/supabase";
import { requireDbRole } from "@/lib/userRole";
import { agreementServices } from "@/lib/billing/agreementServices";
import { billingErrorResponse, isUuid } from "@/lib/billing/http";
import { BillingError } from "@/lib/billing/errors";
import { endPayerFor, payerAccounts } from "@/lib/billing/payers";

/*
 * The landlord accounts the signed-in user pays for (Project B).
 *   GET   { accounts: [{ landlordId, accountName, accountEmail, since, covered,
 *         waiting, needs: "agreement" | "addendum" | null, declined }] }
 *   POST  { action: "void", landlordId, confirm: true } voids the payer's
 *         agreement for that one account: its properties come off, the link
 *         ends, the agreement stands for everything else (Wyatt, 2026-11-09).
 *
 * @auth landlord (accounts they pay for only)
 */
export async function GET() {
  const session = await requireDbRole(["landlord"]);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    return NextResponse.json({ accounts: await payerAccounts(supabase, session.user.id) });
  } catch (err) {
    return billingErrorResponse(err, "load accounts you pay for");
  }
}

export async function POST(req) {
  const session = await requireDbRole(["landlord"]);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const body = await req.json().catch(() => ({}));
    if (body.action !== "void" || !isUuid(body.landlordId)) throw new BillingError("bad_action", "Choose an account to void.");
    if (body.confirm !== true) throw new BillingError("confirm_required", "Confirm that you want to void the agreement for this account.");
    const { documenso } = agreementServices();
    const { data: before } = await supabase.from("billing_payers").select("signer_name").eq("landlord_id", body.landlordId).eq("payer_id", session.user.id).eq("status", "active").maybeSingle();
    const result = await endPayerFor(supabase, documenso, { payerId: session.user.id, landlordId: body.landlordId });
    // The landlord is told, so they can sign themselves or name someone else.
    after(async () => {
      const { data: landlord } = await supabase.from("users").select("id, name, email").eq("id", body.landlordId).maybeSingle();
      if (landlord?.email) await sendPayeeVoidedEmail(landlord, { payerName: before?.signer_name ?? "Your payer", billingUrl: `${getBaseUrl()}/dashboard/landlord?tab=billing` });
    });
    return NextResponse.json({ ...result, accounts: await payerAccounts(supabase, session.user.id) });
  } catch (err) {
    return billingErrorResponse(err, "void for account");
  }
}
