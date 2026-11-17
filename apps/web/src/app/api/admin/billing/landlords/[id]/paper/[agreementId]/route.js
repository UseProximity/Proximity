export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { adminBillingDb, readOnlyResponse } from "@/lib/billing/adminDb";
import { requireDbRole } from "@/lib/userRole";
import { publishCovered, recordPaperAgreement, recordPreview } from "@/lib/billing/paperAgreements";
import { storeSignedAgreement } from "@/lib/billing/agreementFiles";
import { publishProperty } from "@/lib/listings/publish";
import { BillingError } from "@/lib/billing/errors";
import { billingErrorResponse, isUuid } from "@/lib/billing/http";

/*
 * A paper agreement that is out, by id (Wyatt, 2026-11-17).
 *
 * GET   the confirm step: the property picker with what was printed ticked, and
 *       which drafts could go live once covered
 * POST  multipart/form-data: the signed copy is back.
 *         file        the signed PDF (required, up to 4 MB)
 *         exhibit     JSON, the confirmed properties (the picker's choices)
 *         publish     JSON, listing ids of drafts to put live now
 *         signerName, signerTitle (optional), signedAt (YYYY-MM-DD, default today)
 *       Answers { ok, covered, withdrawn, published: [{ listingId, ok, error }] }.
 *
 * Voiding it is the documents route (kind master).
 *
 * @auth admin
 */
async function ids(params) {
  const { id, agreementId } = await params;
  if (!isUuid(id) || !isUuid(agreementId)) throw new BillingError("not_found", "That paper agreement was not found.", 404);
  return { landlordId: id, agreementId };
}

const parseJson = (v, fallback) => {
  try {
    return JSON.parse(String(v ?? ""));
  } catch {
    return fallback;
  }
};

export async function GET(req, { params }) {
  const session = await requireDbRole(["super"]);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const billingDb = adminBillingDb(req);
  try {
    const { landlordId, agreementId } = await ids(params);
    return NextResponse.json(await recordPreview(billingDb.db, landlordId, agreementId));
  } catch (err) {
    return billingErrorResponse(err, "load a paper agreement");
  }
}

export async function POST(req, { params }) {
  const session = await requireDbRole(["super"]);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const billingDb = adminBillingDb(req);
  if (!billingDb.writable) return readOnlyResponse(billingDb);
  try {
    const { landlordId, agreementId } = await ids(params);
    if (!(req.headers.get("content-type") || "").includes("multipart/form-data")) {
      throw new BillingError("file_required", "Upload the signed copy.");
    }
    const form = await req.formData();
    const file = form.get("file");
    if (!file || typeof file !== "object" || !file.size) throw new BillingError("file_required", "Upload the signed copy.");
    const exhibit = parseJson(form.get("exhibit"), null);
    if (!Array.isArray(exhibit)) throw new BillingError("no_properties", "Confirm the properties on the signed copy.");
    const publish = parseJson(form.get("publish"), []);
    const signerName = String(form.get("signerName") ?? "").trim();
    if (!signerName) throw new BillingError("signer_required", "Who signed the agreement?");
    const signedAtRaw = String(form.get("signedAt") ?? "").trim();
    const signedAt = signedAtRaw ? new Date(`${signedAtRaw}T12:00:00Z`) : new Date();
    if (Number.isNaN(signedAt.getTime())) throw new BillingError("bad_date", "That is not a valid signing date.");

    // The form is checked before the upload, so a bad one never leaves a stray file.
    const signedFileKey = await storeSignedAgreement({ userId: landlordId, bytes: new Uint8Array(await file.arrayBuffer()) });
    const result = await recordPaperAgreement(billingDb.db, {
      landlordId,
      id: agreementId,
      exhibit,
      signerName,
      signerTitle: form.get("signerTitle"),
      signedAt,
      signedFileKey,
    });
    const published = await publishCovered(billingDb.db, {
      landlordId,
      agreementId,
      listingIds: Array.isArray(publish) ? publish.filter((x) => isUuid(String(x))).slice(0, 200) : [],
      publishProperty,
    });
    return NextResponse.json({ ok: true, ...result, published });
  } catch (err) {
    return billingErrorResponse(err, "record a paper agreement");
  }
}
