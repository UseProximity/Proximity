export const dynamic = "force-dynamic";

import { NextResponse, after } from "next/server";
import { adminBillingDb, readOnlyResponse } from "@/lib/billing/adminDb";
import { requireDbRole } from "@/lib/userRole";
import { agreementServices } from "@/lib/billing/agreementServices";
import { BillingError } from "@/lib/billing/errors";
import { billingErrorResponse, isUuid } from "@/lib/billing/http";
import { cancelOwnSigning, cleanPayerInput, endPayerFor, namePayer } from "@/lib/billing/payers";
import { endAuthorizedPayer, nameAuthorizedPayer } from "@/lib/billing/authorizedPayers";
import { sendAuthorizedPayerAssigned, sendAuthorizedPayerInvite, sendAuthorizedPayerRemoved, sendPayerAssigned, sendPayerDocumentCancelled, sendPayerInvite, sendPayerRevoked } from "@/lib/billing/payerServices";
import { stampSignup } from "@/lib/marketing/accounts";

/*
 * An admin sets who signs and who pays for landlord accounts (Project B, Wyatt
 * 2026-11-09), so the landlord never has to: several accounts can be given the
 * same signer at once, and the signer signs ONE agreement covering all of them.
 *
 *   POST   { landlordIds: [uuid], name, email, role?: "signer" | "payer", notifyLandlords?: true }
 *          or { listings: [{ landlordId, listingId }], ... } for those listings
 *          only (Wyatt, 2026-11-25): each landlord keeps signing (or paying) for
 *          the rest. `confirm: true` hands over a listing that is covered now: it
 *          is uncovered until the new signer signs.
 *          role "signer" (the default): assigns the signer (a new email gets a
 *          billing-only account), then emails them once (the agreement, the MREC
 *          form and a link) and each landlord a note.
 *          role "payer": names the authorized payer, who is emailed the request
 *          and is only billed once they accept.
 *          Answers { assigned, failed: [{ landlordId, listingId?, error, code? }] }.
 *   DELETE { landlordId, listingId? } ends the account's signer (with listingId,
 *          that listing's own): anything signed for it comes off the signer's
 *          agreement, as when the landlord revokes them.
 *          { landlordId, linkId, role: "payer" } removes an authorized payer.
 *
 * @auth super
 */
export async function POST(req) {
  const session = await requireDbRole(["super"]);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const billingDb = adminBillingDb(req);
  if (!billingDb.writable) return readOnlyResponse(billingDb);
  const db = billingDb.db;
  try {
    const body = await req.json().catch(() => ({}));
    const input = cleanPayerInput(body);
    const role = body.role === "payer" ? "payer" : "signer";
    const listings = Array.isArray(body.listings) ? body.listings.filter((b) => isUuid(b?.landlordId) && isUuid(b?.listingId)).slice(0, 100) : [];
    const ids = listings.length
      ? [...new Set(listings.map((b) => b.landlordId))]
      : Array.isArray(body.landlordIds)
        ? [...new Set(body.landlordIds.filter(isUuid))].slice(0, 50)
        : [];
    if (!ids.length) throw new BillingError("no_landlords", "Choose at least one landlord or listing.");
    const { documenso } = agreementServices();
    const assigned = [];
    const failed = [];
    // What was named: [{ landlordId, listingId | null, link }].
    const made = [];
    const cancelled = [];
    for (const id of ids) {
      // The whole account, or each of its listings chosen, one at a time.
      const targets = listings.length ? listings.filter((b) => b.landlordId === id).map((b) => b.listingId) : [null];
      let landlord = null;
      try {
        const { data, error } = await db.from("users").select("id, name, email").eq("id", id).maybeSingle();
        if (error) throw error;
        if (!data) throw new BillingError("not_found", "Landlord not found.", 404);
        landlord = data;
      } catch (err) {
        failed.push({ landlordId: id, error: err instanceof BillingError ? err.message : "Could not assign." });
        continue;
      }
      for (const listingId of targets) {
        try {
          let result;
          if (role === "payer") {
            result = await nameAuthorizedPayer(db, { landlord, ...input, listingId, createdBy: session.user.id });
          } else {
            // Their own copy in progress is cancelled first: if that fails, nothing is named.
            if (!listingId) await cancelOwnSigning(db, documenso, landlord.id);
            result = await namePayer(db, { landlord, ...input, listingId, createdBy: session.user.id, confirmUncover: body.confirm === true, documenso });
            if (result.uncovered?.cancelled) cancelled.push({ ...result.uncovered.cancelled, causeLandlordId: landlord.id });
          }
          // Writable means this is the site's own database, where the attribution tables live.
          if (result.created) await stampSignup(req, { userId: result.link.payer_id, role: "landlord", label: "invite" });
          made.push({ landlordId: landlord.id, listingId, link: result.link });
          if (!assigned.includes(landlord.id)) assigned.push(landlord.id);
        } catch (err) {
          failed.push({ landlordId: id, ...(listingId && { listingId }), error: err instanceof BillingError ? err.message : "Could not assign.", ...(err instanceof BillingError && { code: err.code }) });
          if (!(err instanceof BillingError)) console.error("billing: admin assign failed", err?.message);
        }
      }
    }
    if (made.length) {
      after(async () => {
        if (role === "payer") {
          for (const m of made) await sendAuthorizedPayerInvite({ link: m.link }).catch((err) => console.error("billing: authorized payer invite failed", err?.message));
        } else {
          // One email to the signer for everything just assigned to them.
          await sendPayerInvite({ landlordIds: assigned, payerId: made[0].link.payer_id }).catch((err) => console.error("billing: payer invite failed", err?.message));
          for (const c of cancelled) await sendPayerDocumentCancelled({ ...c, reason: "changed" }).catch(() => {});
        }
        if (body.notifyLandlords !== false) {
          for (const landlordId of assigned) {
            const listingIds = made.filter((m) => m.landlordId === landlordId && m.listingId).map((m) => m.listingId);
            const note = role === "payer" ? sendAuthorizedPayerAssigned : sendPayerAssigned;
            await note({ landlordId, payerName: input.name, listingIds }).catch(() => {});
          }
        }
      });
    }
    return NextResponse.json({ assigned, failed });
  } catch (err) {
    return billingErrorResponse(err, "assign signer or payer");
  }
}

export async function DELETE(req) {
  const session = await requireDbRole(["super"]);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const billingDb = adminBillingDb(req);
  if (!billingDb.writable) return readOnlyResponse(billingDb);
  const db = billingDb.db;
  try {
    const body = await req.json().catch(() => ({}));
    if (!isUuid(body.landlordId)) throw new BillingError("bad_landlord", "Choose a landlord.");
    if (body.role === "payer") {
      if (!isUuid(body.linkId)) throw new BillingError("bad_link", "Choose an authorized payer.");
      const link = await endAuthorizedPayer(db, { landlordId: body.landlordId, linkId: body.linkId, reason: "ended by an admin" });
      after(() => sendAuthorizedPayerRemoved({ link }).catch(() => {}));
      return NextResponse.json({ ended: true });
    }
    const listingId = isUuid(body.listingId) ? body.listingId : null;
    const { documenso } = agreementServices();
    const result = await endPayerFor(db, documenso, { landlordId: body.landlordId, listingId, reason: "ended by an admin" });
    // The signer is told; a document they were signing for other accounts too was cancelled with it.
    after(() => sendPayerRevoked({ landlordId: body.landlordId, ended: result }).catch(() => {}));
    return NextResponse.json({ released: result.released, cancelled: result.cancelled });
  } catch (err) {
    return billingErrorResponse(err, "end signer or payer");
  }
}
