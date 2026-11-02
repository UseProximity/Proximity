export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { requireDbRole } from "@/lib/userRole";
import { listVersions, uploadVersion, versionView } from "@/lib/billing/agreementVersions";
import { storeAgreementVersion } from "@/lib/billing/agreementFiles";
import { createDocumensoClient, documensoConfigured } from "@/lib/billing/documenso";
import { BillingError } from "@/lib/billing/errors";
import { billingErrorResponse } from "@/lib/billing/http";

/*
 * The commission agreement's versions.
 *
 * GET   every version, newest first, with how many landlords signed each.
 * POST  multipart/form-data { label, file (PDF, 4 MB at most) }: a new draft. It
 *       is pushed to Documenso straight away when Documenso is connected.
 *
 * @auth admin
 */
export async function GET() {
  const session = await requireDbRole(["super", "admin"]);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const versions = await listVersions(supabase);
    const counts = new Map();
    if (versions.length) {
      const { data, error } = await supabase.from("landlord_agreements").select("version_id").eq("status", "signed").not("version_id", "is", null);
      if (error) throw error;
      for (const { version_id } of data) counts.set(version_id, (counts.get(version_id) ?? 0) + 1);
    }
    return NextResponse.json({ versions: versions.map((v) => versionView(v, counts)), documensoConnected: documensoConfigured() });
  } catch (err) {
    return billingErrorResponse(err, "list agreement versions");
  }
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
    const version = await uploadVersion(supabase, createDocumensoClient(), {
      adminId: session.user.id,
      label: form.get("label"),
      fileName: file.name,
      bytes: new Uint8Array(await file.arrayBuffer()),
      storePdf: (bytes) => storeAgreementVersion({ bytes }),
    });
    return NextResponse.json({ version: versionView(version) });
  } catch (err) {
    return billingErrorResponse(err, "upload agreement version");
  }
}
