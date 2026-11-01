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
import { signedAgreementKey, validateSignedPdf } from "./agreementPdf";

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
export function signedAgreementUrl(key) {
  return getSignedUrl(
    r2,
    new GetObjectCommand({
      Bucket: bucket(),
      Key: key,
      ResponseContentDisposition: 'attachment; filename="commission-agreement.pdf"',
    }),
    { expiresIn: 300 }
  );
}
