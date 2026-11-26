export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { adminBillingDb, readOnlyResponse } from "@/lib/billing/adminDb";
import { requireDbRole } from "@/lib/userRole";
import {
  checkVersionFields,
  connectVersion,
  discardVersion,
  getVersion,
  isCustom,
  publishVersion,
  setVersionLandlords,
  versionLandlordRows,
  versionView,
} from "@/lib/billing/agreementVersions";
import { cancelOpenCopies } from "@/lib/billing/versionLandlords";
import { readAgreementFile, signedAgreementUrl } from "@/lib/billing/agreementFiles";
import { agreementServices, documensoClient } from "@/lib/billing/agreementServices";
import { BillingError } from "@/lib/billing/errors";
import { billingErrorResponse, isUuid } from "@/lib/billing/http";

/*
 * One agreement version.
 *
 * GET   a five minute link to the uploaded PDF, to preview it.
 * POST  { action } where action is:
 *         "connect"  push a draft to Documenso (when the upload could not)
 *         "check"    read the template back from Documenso and check its
 *                    signature boxes; a version that passes becomes ready
 *         "publish"  make it live. Needs { requiresResign: boolean }: whether
 *                    landlords who signed an earlier version must sign this one.
 *         "landlords" a custom version: { add: [ids], remove: [ids] } landlords it
 *                    applies to. On a live version it applies now, and an unsigned
 *                    copy a changed landlord has open is cancelled.
 *         "discard"  delete a version that was never live
 *
 * @auth admin
 */
async function versionId(params) {
  const { id } = await params;
  if (!isUuid(id)) throw new BillingError("not_found", "That agreement version was not found.", 404);
  return id;
}

/*
 * The version change is already saved when this runs, so a failure cancelling an
 * old copy is reported as a warning, not as the change failing. A copy left open
 * is on the wrong version: the landlord's next Review and sign replaces it.
 */
async function cancelCopies(supabase, documenso, landlordIds, kind) {
  try {
    // A copy found already signed or declined is applied as the webhook would.
    const { options: envelopeOptions } = agreementServices();
    return { cancelled: await cancelOpenCopies(supabase, documenso, { landlordIds, kind, envelopeOptions }) };
  } catch (err) {
    console.error("billing: could not cancel open agreement copies", err?.message);
    return { cancelled: 0, warning: "Saved, but an unsigned copy a landlord had open could not be cancelled. It is replaced when they next sign." };
  }
}

export async function GET(req, { params }) {
  const session = await requireDbRole(["super"]);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const billingDb = adminBillingDb(req);
  const supabase = billingDb.db;
  try {
    const version = await getVersion(supabase, await versionId(params));
    return NextResponse.json({ url: await signedAgreementUrl(version.file_key, version.file_name || "marketing-agreement.pdf") });
  } catch (err) {
    return billingErrorResponse(err, "open agreement version");
  }
}

export async function POST(req, { params }) {
  const session = await requireDbRole(["super"]);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const billingDb = adminBillingDb(req);
  if (!billingDb.writable) return readOnlyResponse(billingDb);
  const supabase = billingDb.db;
  try {
    const id = await versionId(params);
    const body = await req.json().catch(() => ({}));
    const documenso = documensoClient();

    if (body.action === "connect") {
      const version = await connectVersion(supabase, documenso, await getVersion(supabase, id), null, { readPdf: readAgreementFile });
      return NextResponse.json({ version: versionView(version) });
    }
    if (body.action === "check") {
      // quick: only read the boxes (the admin page opening), no test fill.
      const { version, summary } = await checkVersionFields(supabase, documenso, id, { quick: body.quick === true });
      return NextResponse.json({ version: versionView(version), summary });
    }
    if (body.action === "publish") {
      const version = await publishVersion(supabase, { versionId: id, adminId: session.user.id, requiresResign: body.requiresResign });
      const rows = isCustom(version) ? await versionLandlordRows(supabase, id) : [];
      const copies = await cancelCopies(supabase, documenso, version.changed ?? [], version.kind);
      return NextResponse.json({ version: versionView(version, new Map(), new Map(), rows), ...copies });
    }
    if (body.action === "landlords") {
      const ids = (list) => (Array.isArray(list) ? list : []).filter((x) => typeof x === "string" && isUuid(x));
      const { version, changed } = await setVersionLandlords(supabase, { versionId: id, add: ids(body.add), remove: ids(body.remove), adminId: session.user.id });
      const copies = await cancelCopies(supabase, documenso, changed, version.kind);
      return NextResponse.json({ version: versionView(await getVersion(supabase, id), new Map(), new Map(), await versionLandlordRows(supabase, id)), ...copies });
    }
    if (body.action === "discard") {
      return NextResponse.json(await discardVersion(supabase, id));
    }
    throw new BillingError("bad_action", "Choose connect, check, publish, landlords or discard.");
  } catch (err) {
    if (err?.name === "DocumensoError") {
      console.error("billing: agreement version action failed", err.message);
      return NextResponse.json({ error: `Documenso: ${err.message}` }, { status: 502 });
    }
    return billingErrorResponse(err, "update agreement version");
  }
}
