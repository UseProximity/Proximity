export const dynamic = "force-dynamic";

import { NextResponse, after } from "next/server";
import supabase from "@/lib/supabase";
import { requireDbRole } from "@/lib/userRole";
import { agreementServices } from "@/lib/billing/agreementServices";
import { BillingError } from "@/lib/billing/errors";
import { billingErrorResponse } from "@/lib/billing/http";
import { cancelOwnSigning, changePayer, landlordPayerView, namePayer } from "@/lib/billing/payers";
import { activePayerLink } from "@/lib/billing/payerLinks";
import { sendPayerInvite } from "@/lib/billing/payerServices";
import { cleanDisclosure, getDisclosure, saveDisclosure } from "@/lib/users/licenseDisclosure";

/*
 * The signed-in landlord's payer: the person who signs the marketing agreement
 * and pays for this account (Project B, Wyatt 2026-11-09).
 *
 *   GET    { payer: null } or what the Billing tab shows: the payer's name and
 *          email, status (pending | declined | signed), covered and waiting
 *          listings, and whether the signer can still be changed. Never the agreement.
 *   POST   { name, email, licenseDisclosure? } names the payer and emails them
 *          the agreement, the MREC form and a link. The landlord's own license
 *          answer is asked here when they have none (it still shows on their
 *          listings: "Listed by").
 *   PATCH  { action: "resend" } emails the payer again;
 *          { action: "change", name, email } names someone else (only before
 *          anything was signed for this account).
 *
 * @auth landlord (own account only)
 */
async function landlordOf(userId) {
  const { data, error } = await supabase.from("users").select("id, name, email, billing_only").eq("id", userId).single();
  if (error) throw error;
  return data;
}

export async function GET() {
  const session = await requireDbRole(["landlord"]);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    return NextResponse.json({ payer: await landlordPayerView(supabase, session.user.id) });
  } catch (err) {
    return billingErrorResponse(err, "load payer");
  }
}

export async function POST(req) {
  const session = await requireDbRole(["landlord"]);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const body = await req.json().catch(() => ({}));
    const landlord = await landlordOf(session.user.id);
    if (landlord.billing_only) throw new BillingError("billing_only", "A billing account has no listings to hand to someone else.", 409);
    // Their own license answer first, so nothing is named without it.
    const saved = await getDisclosure(supabase, landlord.id);
    const disclosure = body.licenseDisclosure ? cleanDisclosure(body.licenseDisclosure) : null;
    if (!saved && !disclosure) throw new BillingError("license_disclosure_required", "Answer the real estate license question first.");
    const { link } = await namePayer(supabase, { landlord, name: body.name, email: body.email });
    if (disclosure) await saveDisclosure(supabase, landlord.id, disclosure, { source: "profile" });
    const { documenso } = agreementServices();
    await cancelOwnSigning(supabase, documenso, landlord.id);
    after(() => sendPayerInvite({ landlordId: landlord.id, payerId: link.payer_id }).catch((err) => console.error("billing: payer invite failed", err?.message)));
    return NextResponse.json({ payer: await landlordPayerView(supabase, landlord.id) });
  } catch (err) {
    return billingErrorResponse(err, "name payer");
  }
}

export async function PATCH(req) {
  const session = await requireDbRole(["landlord"]);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const body = await req.json().catch(() => ({}));
    const landlord = await landlordOf(session.user.id);
    if (body.action === "resend") {
      const link = await activePayerLink(supabase, landlord.id);
      if (!link) throw new BillingError("no_payer", "You don't have a payer.", 404);
      // At most one resend a minute, so a double click sends one email.
      if (Date.now() - new Date(link.invited_at).getTime() < 60 * 1000) {
        throw new BillingError("too_soon", "We just emailed them. Try again in a minute.", 429);
      }
      const sent = await sendPayerInvite({ landlordId: landlord.id, payerId: link.payer_id });
      if (!sent) throw new BillingError("send_failed", "We couldn't send the email. Try again in a few minutes.", 502);
    } else if (body.action === "change") {
      const { documenso } = agreementServices();
      const { link } = await changePayer(supabase, documenso, { landlord, name: body.name, email: body.email });
      after(() => sendPayerInvite({ landlordId: landlord.id, payerId: link.payer_id }).catch((err) => console.error("billing: payer invite failed", err?.message)));
    } else {
      throw new BillingError("bad_action", "Choose resend or change.");
    }
    return NextResponse.json({ payer: await landlordPayerView(supabase, landlord.id) });
  } catch (err) {
    return billingErrorResponse(err, "update payer");
  }
}
