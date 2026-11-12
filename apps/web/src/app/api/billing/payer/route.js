export const dynamic = "force-dynamic";

import { NextResponse, after } from "next/server";
import supabase from "@/lib/supabase";
import { requireDbRole } from "@/lib/userRole";
import { billingReader } from "@/lib/billing/viewer";
import { agreementServices } from "@/lib/billing/agreementServices";
import { BillingError } from "@/lib/billing/errors";
import { billingErrorResponse } from "@/lib/billing/http";
import { cancelOwnSigning, changePayer, cleanPayerInput, endPayerFor, landlordPayerView, namePayer } from "@/lib/billing/payers";
import { activePayerLink } from "@/lib/billing/payerLinks";
import { finishTakeover, sendPayerDocumentCancelled, sendPayerInvite, sendPayerRevoked } from "@/lib/billing/payerServices";

/*
 * The signed-in landlord's payer: the person who signs the marketing agreement
 * and pays for this account (Project B, Wyatt 2026-11-09).
 *
 *   GET    { payer: null } or what the Billing tab shows: the payer's name and
 *          email, status (pending | declined | signed), covered and waiting
 *          listings, and whether the signer can still be changed. Never the agreement.
 *   POST   { name, email } names the payer and emails them the agreement, the
 *          MREC form and a link. No license question here: the signer answers it
 *          when they sign, and their details are the "Listed by" on the listings
 *          their agreement covers (Wyatt, 2026-11-10).
 *   PATCH  { action: "resend" } emails the payer again (at most every 30 minutes);
 *          { action: "change", name, email } names someone else (only before
 *          anything was signed for this account);
 *          { action: "revoke", confirm: true } removes the signer, signed or not
 *          (Wyatt, 2026-11-10): the account's listings are no longer covered
 *          until the landlord signs their own agreement. Live listings stay up.
 *          Answers { payer: null, released }. To stay covered instead, the
 *          landlord signs first (POST /api/billing/agreement/sign, takeover) and
 *          the signer is removed when that signature lands.
 *
 * @auth landlord (own account only)
 */
const RESEND_GAP_MS = 30 * 60 * 1000;

async function landlordOf(userId) {
  const { data, error } = await supabase.from("users").select("id, name, email, billing_only").eq("id", userId).single();
  if (error) throw error;
  return data;
}

export async function GET(req) {
  const reader = await billingReader(req);
  if (!reader) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    // They signed their own agreement to take over from their signer, and the
    // follow-up has not run yet (or failed): finish it now.
    if (!reader.viewingAs) await finishTakeover(reader.userId, agreementServices().documenso).catch((err) => console.error("billing: finishing a takeover failed", err?.message));
    return NextResponse.json({ payer: await landlordPayerView(supabase, reader.userId) });
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
    cleanPayerInput(body);
    // Anything they started signing themselves is cancelled first: if that fails,
    // nobody is named, so a copy left open never blocks the payer's addendum.
    const { documenso } = agreementServices();
    await cancelOwnSigning(supabase, documenso, landlord.id);
    const { link } = await namePayer(supabase, { landlord, name: body.name, email: body.email });
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
      // At most one resend every 30 minutes (Wyatt, 2026-11-09).
      const wait = RESEND_GAP_MS - (Date.now() - new Date(link.invited_at).getTime());
      if (wait > 0) {
        const mins = Math.ceil(wait / 60000);
        throw new BillingError("too_soon", `We emailed them recently. You can resend in ${mins} minute${mins === 1 ? "" : "s"}.`, 429);
      }
      const sent = await sendPayerInvite({ landlordId: landlord.id, payerId: link.payer_id });
      if (!sent) throw new BillingError("send_failed", "We couldn't send the email. Try again in a few minutes.", 502);
    } else if (body.action === "change") {
      const { documenso } = agreementServices();
      const { link, cancelled } = await changePayer(supabase, documenso, { landlord, name: body.name, email: body.email });
      after(async () => {
        await sendPayerInvite({ landlordId: landlord.id, payerId: link.payer_id }).catch((err) => console.error("billing: payer invite failed", err?.message));
        // The old signer's document also covered other accounts: it was cancelled whole, so tell them.
        if (cancelled) await sendPayerDocumentCancelled({ ...cancelled, causeLandlordId: landlord.id, reason: "changed" }).catch(() => {});
      });
    } else if (body.action === "revoke") {
      if (body.confirm !== true) throw new BillingError("confirm_required", "Confirm that you want to revoke your authorized signer.");
      const { documenso } = agreementServices();
      const ended = await endPayerFor(supabase, documenso, { landlordId: landlord.id, reason: "revoked by the landlord" });
      after(() => sendPayerRevoked({ landlordId: landlord.id, ended }).catch((err) => console.error("billing: revoked email failed", err?.message)));
      return NextResponse.json({ payer: null, released: ended.released });
    } else {
      throw new BillingError("bad_action", "Choose resend, change or revoke.");
    }
    return NextResponse.json({ payer: await landlordPayerView(supabase, landlord.id) });
  } catch (err) {
    return billingErrorResponse(err, "update payer");
  }
}
