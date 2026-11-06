/*
 * Storing and fetching a signed agreement PDF in Cloudflare R2.
 *
 * Only the object key is saved in the database (landlord_agreements.signed_file_key),
 * never a URL. A copy is opened through a route that checks who is asking and then
 * hands back a link that works for five minutes, so the file is not reachable by
 * anyone who merely finds the key.
 *
 * R2_PRIVATE_BUCKET_NAME, when set, keeps agreements in a bucket that is not
 * public. Without it they go in the app's image bucket, whose public address
 * serves anything whose key is known; the key here ends in a random id, but a
 * private bucket is the better home, and switching to one is a setting, not a
 * code change.
 */
import { randomUUID } from "node:crypto";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getBucket, r2 } from "@/lib/r2";
import { agreementVersionKey, mergeSignedParts, pageCount, signedAgreementKey, validateSignedPdf } from "./agreementPdf";

const bucket = () => process.env.R2_PRIVATE_BUCKET_NAME || getBucket();

// Validates the PDF, stores it and returns its key.
export async function storeSignedAgreement({ userId, bytes }) {
  validateSignedPdf(bytes);
  const key = signedAgreementKey(userId, randomUUID());
  await r2.send(
    new PutObjectCommand({
      Bucket: bucket(),
      Key: key,
      Body: bytes,
      ContentType: "application/pdf",
    })
  );
  return key;
}

// A short-lived download link for a stored agreement.
export function signedAgreementUrl(key, filename = "commission-agreement.pdf") {
  return getSignedUrl(
    r2,
    new GetObjectCommand({
      Bucket: bucket(),
      Key: key,
      ResponseContentDisposition: `attachment; filename="${filename.replace(/[^\w.-]+/g, "-")}"`,
    }),
    { expiresIn: 300 }
  );
}

// An uploaded agreement version (the unsigned PDF). Validates it, stores it, returns its key.
export async function storeAgreementVersion({ bytes }) {
  validateSignedPdf(bytes, "agreement");
  const key = agreementVersionKey(randomUUID());
  await r2.send(new PutObjectCommand({ Bucket: bucket(), Key: key, Body: bytes, ContentType: "application/pdf" }));
  return key;
}

// A stored agreement's bytes: to push a version to Documenso, or attach it to an email.
export async function readAgreementFile(key) {
  const res = await r2.send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
  return new Uint8Array(await res.Body.transformToByteArray());
}

// A signed document as one PDF (documentParts): the agreement, Exhibit A, then the signing certificates.
export async function combinedSignedPdf(parts) {
  const loaded = [];
  for (const part of parts) {
    const bytes = await readAgreementFile(part.key);
    const original = part.originalKey ? await readAgreementFile(part.originalKey).catch(() => null) : null;
    loaded.push({ bytes, bodyPages: original ? await pageCount(original) : null });
  }
  return mergeSignedParts(loaded);
}

// The HTTP response for that PDF, opened in the browser rather than downloaded.
export function pdfResponse(bytes, filename) {
  return new Response(bytes, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename.replace(/[^\w.-]+/g, "-")}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
