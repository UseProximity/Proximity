export const dynamic = "force-dynamic";

import { NextResponse, after } from "next/server";
import supabase from "@/lib/supabase";
import { requireDbRole } from "@/lib/userRole";
import { billingReader } from "@/lib/billing/viewer";
import { BillingError } from "@/lib/billing/errors";
import { billingErrorResponse, isUuid } from "@/lib/billing/http";
import { acceptAuthorizedPayer, declineAuthorizedPayer, payingFor } from "@/lib/billing/authorizedPayers";
import { sendAuthorizedPayerAnswer } from "@/lib/billing/payerServices";

/*
 * What the signed-in user was asked to pay for as an authorized payer (Wyatt,
 * 2026-11-25): each landlord account, or one listing of it.
 *
 *   GET    { accounts: [{ linkId, landlordId, accountName, scope, listingId,
 *          listingAddress, status: "pending" | "accepted", invitedAt, acceptedAt }] }
 *   PATCH  { action: "accept", linkId } from now on the charges made for it are
 *          invoiced to them, and the landlord is emailed;
 *          { action: "decline", linkId } before accepting only: the request ends
 *          and nothing changes. After accepting, only the landlord or Proximity
 *          can remove them.
 *
 * @auth landlord (requests naming them only)
 */
export async function GET(req) {
  const reader = await billingReader(req);
  if (!reader) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    return NextResponse.json({ accounts: await payingFor(supabase, reader.userId) });
  } catch (err) {
    return billingErrorResponse(err, "load what you pay for");
  }
}

export async function PATCH(req) {
  const session = await requireDbRole(["landlord"]);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const body = await req.json().catch(() => ({}));
    if (!isUuid(body.linkId)) throw new BillingError("bad_link", "Choose a request.");
    if (body.action === "accept") {
      const link = await acceptAuthorizedPayer(supabase, { userId: session.user.id, linkId: body.linkId });
      after(() => sendAuthorizedPayerAnswer({ link, accepted: true }).catch((err) => console.error("billing: payer accepted email failed", err?.message)));
    } else if (body.action === "decline") {
      const link = await declineAuthorizedPayer(supabase, { userId: session.user.id, linkId: body.linkId });
      after(() => sendAuthorizedPayerAnswer({ link, accepted: false }).catch((err) => console.error("billing: payer declined email failed", err?.message)));
    } else {
      throw new BillingError("bad_action", "Choose accept or decline.");
    }
    return NextResponse.json({ accounts: await payingFor(supabase, session.user.id) });
  } catch (err) {
    return billingErrorResponse(err, "answer a request to pay");
  }
}
