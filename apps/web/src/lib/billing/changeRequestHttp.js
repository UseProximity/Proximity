/*
 * Reading a change request message from a route: JSON, or multipart/form-data
 * when a file is attached ("file"). Returns the text fields as strings and the
 * file as { bytes, name } (or null).
 */
const FIELDS = ["action", "documentKind", "agreementId", "amendmentId", "versionId", "section", "body", "proposedText", "note"];

export async function readChangeRequestBody(req) {
  if ((req.headers.get("content-type") || "").includes("multipart/form-data")) {
    const form = await req.formData();
    const out = {};
    for (const f of FIELDS) {
      const v = form.get(f);
      if (typeof v === "string" && v !== "") out[f] = v;
    }
    const file = form.get("file");
    out.file =
      file && typeof file === "object" && file.size > 0
        ? { bytes: new Uint8Array(await file.arrayBuffer()), name: file.name || "attachment" }
        : null;
    return out;
  }
  const body = await req.json().catch(() => ({}));
  const out = {};
  for (const f of FIELDS) if (typeof body?.[f] === "string" && body[f] !== "") out[f] = body[f];
  out.file = null;
  return out;
}

// An optional id field: absent, or a uuid.
export const optionalId = (v, isUuid) => (v == null ? null : isUuid(v) ? v : undefined);
