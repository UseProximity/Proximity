export const dynamic = "force-dynamic";

import { NextResponse, after } from "next/server";
import supabase from "@/lib/supabase";
import { requireDbRole } from "@/lib/userRole";
import { billingReader } from "@/lib/billing/viewer";
import { BillingError } from "@/lib/billing/errors";
import { billingErrorResponse, isUuid } from "@/lib/billing/http";
import { changeAuthorizedPayer, endAuthorizedPayer, landlordPayersView, nameAuthorizedPayer, touchPayerInvite } from "@/lib/billing/authorizedPayers";
import { sendAuthorizedPayerInvite, sendAuthorizedPayerRemoved } from "@/lib/billing/payerServices";
import { stampSignup } from "@/lib/marketing/accounts";

/*
 * The signed-in landlord's authorized payers (Wyatt, 2026-11-25): the people
 * invoiced for the account, or for one of its listings, once they accept.
 *
 *   GET    { account, listings }: the account-wide payer (or null) and the
 *          listings with a payer of their own, each pending or accepted.
 *   POST   { name, email, listingId? } names one and emails them the request.
 *          Nothing is billed to them until they accept.
 *   PATCH  { action: "resend", linkId } emails them again (at most every 30
 *          minutes, only before they accept);
 *          { action: "change", linkId, name, email } names someone else there;
 *          { action: "revoke", linkId, confirm: true } removes them. New charges
 *          go back to whoever signs, or the landlord; charges already made stay
 *          with the payer.
 *
 * @auth landlord (own account only)
 */
async function landlordOf(userId) {
  const { data, error } = await supabase.from("users").select("id, name, email, billing_only").eq("id", userId).single();
  if (error) throw error;
  return data;
}

const inviteLater = (link) => after(() => sendAuthorizedPayerInvite({ link }).catch((err) => console.error("billing: authorized payer invite failed", err?.message)));

export async function GET(req) {
  const reader = await billingReader(req);
  if (!reader) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    return NextResponse.json(await landlordPayersView(supabase, reader.userId));
  } catch (err) {
    return billingErrorResponse(err, "load authorized payers");
  }
}

export async function POST(req) {
  const session = await requireDbRole(["landlord"]);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const body = await req.json().catch(() => ({}));
    const landlord = await landlordOf(session.user.id);
    if (landlord.billing_only) throw new BillingError("billing_only", "A billing account has no listings for someone else to pay for.", 409);
    if (body.listingId != null && !isUuid(body.listingId)) throw new BillingError("bad_listing", "Choose one of your listings.");
    const { link, created } = await nameAuthorizedPayer(supabase, { landlord, name: body.name, email: body.email, listingId: body.listingId ?? null });
    if (created) await stampSignup(req, { userId: link.payer_id, role: "landlord", label: "invite" });
    inviteLater(link);
    return NextResponse.json(await landlordPayersView(supabase, landlord.id));
  } catch (err) {
    return billingErrorResponse(err, "name authorized payer");
  }
}

export async function PATCH(req) {
  const session = await requireDbRole(["landlord"]);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const body = await req.json().catch(() => ({}));
    if (!isUuid(body.linkId)) throw new BillingError("bad_link", "Choose an authorized payer.");
    const landlord = await landlordOf(session.user.id);
    if (body.action === "resend") {
      const link = await touchPayerInvite(supabase, { landlordId: landlord.id, linkId: body.linkId });
      const sent = await sendAuthorizedPayerInvite({ link });
      if (!sent) throw new BillingError("send_failed", "We couldn't send the email. Try again in a few minutes.", 502);
    } else if (body.action === "change") {
      const { link, created, old } = await changeAuthorizedPayer(supabase, { landlord, linkId: body.linkId, name: body.name, email: body.email });
      if (created) await stampSignup(req, { userId: link.payer_id, role: "landlord", label: "invite" });
      inviteLater(link);
      after(() => sendAuthorizedPayerRemoved({ link: old }).catch(() => {}));
    } else if (body.action === "revoke") {
      if (body.confirm !== true) throw new BillingError("confirm_required", "Confirm that you want to remove this authorized payer.");
      const link = await endAuthorizedPayer(supabase, { landlordId: landlord.id, linkId: body.linkId });
      after(() => sendAuthorizedPayerRemoved({ link }).catch((err) => console.error("billing: payer removed email failed", err?.message)));
    } else {
      throw new BillingError("bad_action", "Choose resend, change or revoke.");
    }
    return NextResponse.json(await landlordPayersView(supabase, landlord.id));
  } catch (err) {
    return billingErrorResponse(err, "update authorized payer");
  }
}
