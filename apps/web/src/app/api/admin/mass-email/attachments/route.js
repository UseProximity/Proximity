export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { storeMassEmailFile } from "@/lib/billing/agreementFiles";
import { errorResponse, massEmailContext } from "@/lib/massEmail/http";
import { MassEmailError } from "@/lib/massEmail/send";

/*
 * Uploads a PDF to attach to a mass email version (4 MB at most). The answer is
 * the attachment to include when saving the version; nothing is attached until
 * a version that lists it is saved.
 *
 * POST multipart/form-data with `file` -> { attachment: { kind: "file", key, fileName, size } }
 *
 * @auth admin
 */
export async function POST(req) {
  const ctx = await massEmailContext(req, { write: true });
  if (ctx.response) return ctx.response;
  try {
    if (!(req.headers.get("content-type") || "").includes("multipart/form-data")) {
      throw new MassEmailError("file_required", "Choose a PDF to attach.");
    }
    const file = (await req.formData()).get("file");
    if (!file || typeof file !== "object" || !file.size) throw new MassEmailError("file_required", "Choose a PDF to attach.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const key = await storeMassEmailFile({ bytes });
    const fileName = String(file.name || "attachment.pdf").replace(/[^\w .()-]+/g, "-").slice(0, 120);
    return NextResponse.json({ attachment: { kind: "file", key, fileName, size: bytes.length } });
  } catch (err) {
    return errorResponse(err, "upload attachment");
  }
}
