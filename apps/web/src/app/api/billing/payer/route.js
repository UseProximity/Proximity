export const dynamic = "force-dynamic";

import { NextResponse, after } from "next/server";
import supabase from "@/lib/supabase";
import { requireDbRole } from "@/lib/userRole";
import { billingReader } from "@/lib/billing/viewer";
import { agreementServices } from "@/lib/billing/agreementServices";
import { BillingError } from "@/lib/billing/errors";
import { billingErrorResponse, isUuid } from "@/lib/billing/http";
import { cancelOwnSigning, changePayer, cleanPayerInput, endPayerFor, landlordListingSignerViews, landlordPayerView, namePayer } from "@/lib/billing/payers";
import { signerLinksFor } from "@/lib/billing/payerLinks";
import { sendPayerDocumentCancelled, sendPayerInvite, sendPayerRevoked } from "@/lib/billing/payerServices";
import { stampSignup } from "@/lib/marketing/accounts";

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
 * Every write takes an optional `listingId` (Wyatt, 2026-11-25): the signer of
 * that one listing, who takes it from the account's signer (or the landlord).
 * Naming one for a listing that is covered now answers 409 `listing_covered`
 * with the warning to show; sending again with `confirm: true` takes the listing
 * off the agreement covering it, uncovered until the new signer signs. GET also
 * answers `listingSigners`: one view per listing with its own signer.
 *
 * @auth landlord (own account only)
 */
const RESEND_GAP_MS = 30 * 60 * 1000;

async function landlordOf(userId) {
  const { data, error } = await supabase.from("users").select("id, name, email, billing_only").eq("id", userId).single();
  if (error) throw error;
  return data;
}

// The account's signer (status only), and a card for each listing with its own.
const views = async (landlordId) => ({ payer: await landlordPayerView(supabase, landlordId), listingSigners: await landlordListingSignerViews(supabase, landlordId) });

// The listing a write is about: null for the whole account.
function listingOf(body) {
  if (body.listingId == null) return null;
  if (!isUuid(body.listingId)) throw new BillingError("bad_listing", "Choose one of your listings.");
  return body.listingId;
}

export async function GET(req) {
  const reader = await billingReader(req);
  if (!reader) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    return NextResponse.json(await views(reader.userId));
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
    const listingId = listingOf(body);
    // Anything they started signing themselves is cancelled first: if that fails,
    // nobody is named, so a copy left open never blocks the payer's addendum.
    // (For one listing they keep signing for the rest: only a copy listing it goes.)
    const { documenso } = agreementServices();
    if (!listingId) await cancelOwnSigning(supabase, documenso, landlord.id);
    const { link, created, uncovered } = await namePayer(supabase, { landlord, name: body.name, email: body.email, listingId, confirmUncover: body.confirm === true, documenso });
    // The account signer's agreement, being signed for other accounts too, went with it: tell them.
    if (uncovered?.cancelled) after(() => sendPayerDocumentCancelled({ ...uncovered.cancelled, causeLandlordId: landlord.id, reason: "changed" }).catch(() => {}));
    // A billing account made for the invited signer: labelled "invite", not the landlord's visit.
    if (created) await stampSignup(req, { userId: link.payer_id, role: "landlord", label: "invite" });
    after(() => sendPayerInvite({ landlordId: landlord.id, payerId: link.payer_id }).catch((err) => console.error("billing: payer invite failed", err?.message)));
    return NextResponse.json(await views(landlord.id));
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
    const listingId = listingOf(body);
    if (body.action === "resend") {
      const links = await signerLinksFor(supabase, landlord.id);
      const link = listingId ? links.byListing.get(listingId) ?? null : links.account;
      if (!link) throw new BillingError("no_payer", "You don't have an authorized signer there.", 404);
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
      const { link, cancelled, created } = await changePayer(supabase, documenso, { landlord, name: body.name, email: body.email, listingId });
      if (created) await stampSignup(req, { userId: link.payer_id, role: "landlord", label: "invite" });
      after(async () => {
        await sendPayerInvite({ landlordId: landlord.id, payerId: link.payer_id }).catch((err) => console.error("billing: payer invite failed", err?.message));
        // The old signer's document also covered other accounts: it was cancelled whole, so tell them.
        if (cancelled) await sendPayerDocumentCancelled({ ...cancelled, causeLandlordId: landlord.id, reason: "changed" }).catch(() => {});
      });
    } else if (body.action === "revoke") {
      if (body.confirm !== true) throw new BillingError("confirm_required", "Confirm that you want to revoke your authorized signer.");
      const { documenso } = agreementServices();
      const ended = await endPayerFor(supabase, documenso, { landlordId: landlord.id, listingId, reason: "revoked by the landlord" });
      after(() => sendPayerRevoked({ landlordId: landlord.id, ended }).catch((err) => console.error("billing: revoked email failed", err?.message)));
      return NextResponse.json({ ...(await views(landlord.id)), released: ended.released });
    } else {
      throw new BillingError("bad_action", "Choose resend, change or revoke.");
    }
    return NextResponse.json(await views(landlord.id));
  } catch (err) {
    return billingErrorResponse(err, "update payer");
  }
}
