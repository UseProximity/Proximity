export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { adminBillingDb, readOnlyResponse } from "@/lib/billing/adminDb";
import { requireDbRole } from "@/lib/userRole";
import { isCustom, listVersions, resignCutoff, signatureStillValid, uploadVersion, versionLandlordRows, versionView } from "@/lib/billing/agreementVersions";
import { storeAgreementVersion } from "@/lib/billing/agreementFiles";
import { documensoConfigured } from "@/lib/billing/documenso";
import { documensoClient } from "@/lib/billing/agreementServices";
import { BillingError } from "@/lib/billing/errors";
import { billingErrorResponse, isUuid } from "@/lib/billing/http";

/*
 * The commission agreement's versions.
 *
 * GET   every version, newest first, with how many landlords signed each,
 *       whether a retired one is still in force (landlords signed on it whose
 *       signature still counts) and, for a custom version, the landlords it applies to.
 * POST  multipart/form-data: a new draft, pushed to Documenso straight away when
 *       Documenso is connected.
 *         label                  the version's name
 *         file                   the PDF, 4 MB at most
 *         kind                   master (the agreement) | amendment (Exhibit A amendment)
 *         audience               everyone (standard) | selected (a custom version)
 *         landlordIds            for a custom version: the landlords it starts with
 *                                (repeated field; may be none, they can be added later)
 *         landlordId             optional: one landlord (same as landlordIds of one)
 *         changeRequestId        optional: the change request it answers
 *         basedOnVersionId       optional: the standard version it was edited from
 *
 * @auth admin
 */
export async function GET(req) {
  const session = await requireDbRole(["super"]);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const billingDb = adminBillingDb(req);
  const supabase = billingDb.db;
  try {
    const versions = await listVersions(supabase);
    const counts = new Map();
    const names = new Map();
    let landlordRows = [];
    if (versions.length) {
      const [masters, amendments] = await Promise.all([
        supabase.from("landlord_agreements").select("version_id").eq("status", "signed").not("version_id", "is", null),
        supabase.from("agreement_amendments").select("version_id").eq("status", "signed").not("version_id", "is", null),
      ]);
      if (masters.error) throw masters.error;
      if (amendments.error) throw amendments.error;
      for (const { version_id } of [...masters.data, ...amendments.data]) counts.set(version_id, (counts.get(version_id) ?? 0) + 1);
      landlordRows = await versionLandlordRows(supabase, versions.filter(isCustom).map((v) => v.id));
      const landlordIds = [...new Set(landlordRows.map((r) => r.landlord_id))];
      if (landlordIds.length) {
        const { data, error } = await supabase.from("users").select("id, name, email, company_name").in("id", landlordIds);
        if (error) throw error;
        for (const u of data) names.set(u.id, u.name || u.company_name || u.email);
      }
    }
    // A signature on a retired standard agreement stops counting once a later version
    // required everyone to sign again; amendments and negotiated versions never do.
    const cutoff = versions.length ? await resignCutoff(supabase) : null;
    const inForce = (v) =>
      (counts.get(v.id) ?? 0) > 0 && (v.kind === "amendment" || isCustom(v) || signatureStillValid(v.published_at, cutoff));
    return NextResponse.json({
      versions: versions.map((v) => ({ ...versionView(v, counts, names, landlordRows.filter((r) => r.version_id === v.id)), stillInForce: v.status === "retired" && inForce(v) })),
      documensoConnected: documensoConfigured(),
    });
  } catch (err) {
    return billingErrorResponse(err, "list agreement versions");
  }
}

function uuidOrNull(value) {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || !isUuid(value)) throw new BillingError("bad_id", "That landlord or request id is not valid.");
  return value;
}

export async function POST(req) {
  const session = await requireDbRole(["super"]);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const billingDb = adminBillingDb(req);
  if (!billingDb.writable) return readOnlyResponse(billingDb);
  const supabase = billingDb.db;
  try {
    if (!(req.headers.get("content-type") || "").includes("multipart/form-data")) {
      throw new BillingError("file_required", "Choose the agreement PDF to upload.");
    }
    const form = await req.formData();
    const file = form.get("file");
    if (!file || typeof file !== "object" || !file.size) throw new BillingError("file_required", "Choose the agreement PDF to upload.");
    const version = await uploadVersion(supabase, documensoClient(), {
      adminId: session.user.id,
      label: form.get("label"),
      fileName: file.name,
      bytes: new Uint8Array(await file.arrayBuffer()),
      storePdf: (bytes) => storeAgreementVersion({ bytes }),
      kind: form.get("kind") === "amendment" ? "amendment" : "master",
      audience: form.get("audience") === "selected" ? "selected" : "everyone",
      landlordIds: form.getAll("landlordIds").map(uuidOrNull).filter(Boolean),
      landlordId: uuidOrNull(form.get("landlordId")),
      changeRequestId: uuidOrNull(form.get("changeRequestId")),
      basedOnVersionId: uuidOrNull(form.get("basedOnVersionId")),
    });
    return NextResponse.json({ version: versionView(version, new Map(), new Map(), await versionLandlordRows(supabase, version.id)) });
  } catch (err) {
    return billingErrorResponse(err, "upload agreement version");
  }
}
