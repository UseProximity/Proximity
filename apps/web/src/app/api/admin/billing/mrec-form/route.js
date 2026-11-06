export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { requireDbRole } from "@/lib/userRole";
import { signedAgreementUrl, storeMrecForm } from "@/lib/billing/agreementFiles";
import { BillingError } from "@/lib/billing/errors";
import { billingErrorResponse } from "@/lib/billing/http";
import { MREC_FORM_FILENAME, getMrecForm, saveMrecForm } from "@/lib/users/mrecForm";

/*
 * The MREC Broker Disclosure Form emailed to every new landlord (lib/users/mrecForm.js).
 *
 * GET   the current form: { form: { fileName, size, uploadedAt } | null }.
 *       With ?download=1, { url }: a link to the PDF that works for five minutes.
 * POST  multipart/form-data with `file`, the PDF (4 MB at most). Replaces the
 *       form from the next email on; emails already sent are not resent.
 *
 * @auth admin
 */
export async function GET(req) {
  const session = await requireDbRole(["super", "admin"]);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const form = await getMrecForm(supabase);
    if (new URL(req.url).searchParams.get("download")) {
      if (!form) throw new BillingError("no_form", "No form has been uploaded yet.", 404);
      return NextResponse.json({ url: await signedAgreementUrl(form.key, form.fileName || MREC_FORM_FILENAME) });
    }
    return NextResponse.json({ form: form && { fileName: form.fileName, size: form.size, uploadedAt: form.uploadedAt } });
  } catch (err) {
    return billingErrorResponse(err, "read the broker disclosure form");
  }
}

export async function POST(req) {
  const session = await requireDbRole(["super", "admin"]);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    if (!(req.headers.get("content-type") || "").includes("multipart/form-data")) {
      throw new BillingError("file_required", "Choose the form PDF to upload.");
    }
    const file = (await req.formData()).get("file");
    if (!file || typeof file !== "object" || !file.size) throw new BillingError("file_required", "Choose the form PDF to upload.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const key = await storeMrecForm({ bytes });
    const form = await saveMrecForm(supabase, { key, fileName: file.name, size: bytes.length, adminId: session.user.id });
    return NextResponse.json({ form: { fileName: form.fileName, size: form.size, uploadedAt: form.uploadedAt } });
  } catch (err) {
    return billingErrorResponse(err, "upload the broker disclosure form");
  }
}
