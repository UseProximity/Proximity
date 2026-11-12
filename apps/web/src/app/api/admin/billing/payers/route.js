export const dynamic = "force-dynamic";

import { NextResponse, after } from "next/server";
import { adminBillingDb, readOnlyResponse } from "@/lib/billing/adminDb";
import { requireDbRole } from "@/lib/userRole";
import { agreementServices } from "@/lib/billing/agreementServices";
import { BillingError } from "@/lib/billing/errors";
import { billingErrorResponse, isUuid } from "@/lib/billing/http";
import { cancelOwnSigning, cleanPayerInput, endPayerFor, namePayer } from "@/lib/billing/payers";
import { activePayerLink } from "@/lib/billing/payerLinks";
import { sendPayerAssigned, sendPayerDocumentCancelled, sendPayerInvite } from "@/lib/billing/payerServices";

/*
 * An admin sets who signs and pays for landlord accounts (Project B, Wyatt
 * 2026-11-09), so the landlord never has to: several accounts can be given the
 * same payer at once, and the payer signs ONE agreement covering all of them.
 *
 *   POST   { landlordIds: [uuid], name, email, notifyLandlords?: true }
 *          Assigns the payer to each account (a new email gets a billing-only
 *          account), then emails the payer once (the agreement, the MREC form and
 *          a link) and each landlord a note. Answers { assigned, failed: [{ landlordId, error }] }.
 *   DELETE { landlordId } ends the account's payer: anything signed for it comes
 *          off the payer's agreement, as when the landlord revokes them.
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
    const ids = Array.isArray(body.landlordIds) ? [...new Set(body.landlordIds.filter(isUuid))].slice(0, 50) : [];
    if (!ids.length) throw new BillingError("no_landlords", "Choose at least one landlord.");
    const { documenso } = agreementServices();
    const assigned = [];
    const failed = [];
    let payerId = null;
    for (const id of ids) {
      try {
        const { data: landlord, error } = await db.from("users").select("id, name, email").eq("id", id).maybeSingle();
        if (error) throw error;
        if (!landlord) throw new BillingError("not_found", "Landlord not found.", 404);
        // Their own copy in progress is cancelled first: if that fails, nothing is named.
        await cancelOwnSigning(db, documenso, landlord.id);
        const { link } = await namePayer(db, { landlord, ...input, createdBy: session.user.id });
        payerId = link.payer_id;
        assigned.push(landlord.id);
      } catch (err) {
        failed.push({ landlordId: id, error: err instanceof BillingError ? err.message : "Could not assign." });
        if (!(err instanceof BillingError)) console.error("billing: admin payer assign failed", err?.message);
      }
    }
    if (assigned.length && payerId) {
      after(async () => {
        await sendPayerInvite({ landlordIds: assigned, payerId }).catch((err) => console.error("billing: payer invite failed", err?.message));
        if (body.notifyLandlords !== false) {
          for (const landlordId of assigned) await sendPayerAssigned({ landlordId, payerName: input.name }).catch(() => {});
        }
      });
    }
    return NextResponse.json({ assigned, failed });
  } catch (err) {
    return billingErrorResponse(err, "assign payer");
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
    const link = await activePayerLink(db, body.landlordId);
    if (!link) throw new BillingError("no_payer", "This landlord has no authorized signer.", 404);
    const { documenso } = agreementServices();
    const result = await endPayerFor(db, documenso, { landlordId: body.landlordId, reason: "ended by an admin" });
    // A document the payer was signing for other accounts too was cancelled: tell them.
    if (result.cancelled) after(() => sendPayerDocumentCancelled({ ...result.cancelled, causeLandlordId: body.landlordId, reason: "ended" }).catch(() => {}));
    return NextResponse.json({ released: result.released, cancelled: result.cancelled });
  } catch (err) {
    return billingErrorResponse(err, "end payer");
  }
}
