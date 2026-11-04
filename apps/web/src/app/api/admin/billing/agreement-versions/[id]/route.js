export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { requireDbRole } from "@/lib/userRole";
import {
  checkVersionFields,
  connectVersion,
  discardVersion,
  getVersion,
  publishVersion,
  versionView,
} from "@/lib/billing/agreementVersions";
import { readAgreementFile, signedAgreementUrl } from "@/lib/billing/agreementFiles";
import { documensoClient } from "@/lib/billing/agreementServices";
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
 *         "discard"  delete a version that was never live
 *
 * @auth admin
 */
async function versionId(params) {
  const { id } = await params;
  if (!isUuid(id)) throw new BillingError("not_found", "That agreement version was not found.", 404);
  return id;
}

export async function GET(_req, { params }) {
  const session = await requireDbRole(["super", "admin"]);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const version = await getVersion(supabase, await versionId(params));
    return NextResponse.json({ url: await signedAgreementUrl(version.file_key, version.file_name || "commission-agreement.pdf") });
  } catch (err) {
    return billingErrorResponse(err, "open agreement version");
  }
}

export async function POST(req, { params }) {
  const session = await requireDbRole(["super", "admin"]);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const id = await versionId(params);
    const body = await req.json().catch(() => ({}));
    const documenso = documensoClient();

    if (body.action === "connect") {
      const version = await connectVersion(supabase, documenso, await getVersion(supabase, id), null, { readPdf: readAgreementFile });
      return NextResponse.json({ version: versionView(version) });
    }
    if (body.action === "check") {
      const { version, summary } = await checkVersionFields(supabase, documenso, id);
      return NextResponse.json({ version: versionView(version), summary });
    }
    if (body.action === "publish") {
      const version = await publishVersion(supabase, { versionId: id, adminId: session.user.id, requiresResign: body.requiresResign });
      return NextResponse.json({ version: versionView(version) });
    }
    if (body.action === "discard") {
      return NextResponse.json(await discardVersion(supabase, id));
    }
    throw new BillingError("bad_action", "Choose connect, check, publish or discard.");
  } catch (err) {
    if (err?.name === "DocumensoError") {
      console.error("billing: agreement version action failed", err.message);
      return NextResponse.json({ error: `Documenso: ${err.message}` }, { status: 502 });
    }
    return billingErrorResponse(err, "update agreement version");
  }
}
