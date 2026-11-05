export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { requireDbRole } from "@/lib/userRole";
import { listVersions, resignCutoff, signatureStillValid, uploadVersion, versionView } from "@/lib/billing/agreementVersions";
import { storeAgreementVersion } from "@/lib/billing/agreementFiles";
import { documensoConfigured } from "@/lib/billing/documenso";
import { documensoClient } from "@/lib/billing/agreementServices";
import { BillingError } from "@/lib/billing/errors";
import { billingErrorResponse } from "@/lib/billing/http";

/*
 * The commission agreement's versions.
 *
 * GET   every version, newest first, with how many landlords signed each,
 *       whether a retired one is still in force (landlords signed on it whose
 *       signature still counts) and, for a negotiated version, its landlord's name.
 * POST  multipart/form-data: a new draft, pushed to Documenso straight away when
 *       Documenso is connected.
 *         label                  the version's name
 *         file                   the PDF, 4 MB at most
 *         kind                   master (the agreement) | amendment (Exhibit A amendment)
 *         commissionRatePercent  the rate this document sets, filled into its
 *                                "Commission rate" box and shown on invoices
 *         landlordId             optional: a version negotiated with one landlord
 *         changeRequestId        optional: the change request it answers
 *         basedOnVersionId       optional: the standard version it was edited from
 *
 * @auth admin
 */
export async function GET() {
  const session = await requireDbRole(["super", "admin"]);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const versions = await listVersions(supabase);
    const counts = new Map();
    const names = new Map();
    if (versions.length) {
      const [masters, amendments] = await Promise.all([
        supabase.from("landlord_agreements").select("version_id").eq("status", "signed").not("version_id", "is", null),
        supabase.from("agreement_amendments").select("version_id").eq("status", "signed").not("version_id", "is", null),
      ]);
      if (masters.error) throw masters.error;
      if (amendments.error) throw amendments.error;
      for (const { version_id } of [...masters.data, ...amendments.data]) counts.set(version_id, (counts.get(version_id) ?? 0) + 1);
      const landlordIds = [...new Set(versions.map((v) => v.landlord_id).filter(Boolean))];
      if (landlordIds.length) {
        const { data, error } = await supabase.from("users").select("id, name, email, company_name").in("id", landlordIds);
        if (error) throw error;
        for (const u of data) names.set(u.id, u.company_name || u.name || u.email);
      }
    }
    // A signature on a retired standard agreement stops counting once a later version
    // required everyone to sign again; amendments and negotiated versions never do.
    const cutoff = versions.length ? await resignCutoff(supabase) : null;
    const inForce = (v) =>
      (counts.get(v.id) ?? 0) > 0 && (v.kind === "amendment" || !!v.landlord_id || signatureStillValid(v.published_at, cutoff));
    return NextResponse.json({
      versions: versions.map((v) => ({ ...versionView(v, counts, names), stillInForce: v.status === "retired" && inForce(v) })),
      documensoConnected: documensoConfigured(),
    });
  } catch (err) {
    return billingErrorResponse(err, "list agreement versions");
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function uuidOrNull(value) {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || !UUID.test(value)) throw new BillingError("bad_id", "That landlord or request id is not valid.");
  return value;
}

export async function POST(req) {
  const session = await requireDbRole(["super", "admin"]);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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
      commissionRatePercent: form.get("commissionRatePercent"),
      landlordId: uuidOrNull(form.get("landlordId")),
      changeRequestId: uuidOrNull(form.get("changeRequestId")),
      basedOnVersionId: uuidOrNull(form.get("basedOnVersionId")),
    });
    return NextResponse.json({ version: versionView(version) });
  } catch (err) {
    return billingErrorResponse(err, "upload agreement version");
  }
}
