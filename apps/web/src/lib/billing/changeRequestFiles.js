/*
 * Storing and opening change request attachments in Cloudflare R2, in the same
 * private bucket as signed agreements (R2_PRIVATE_BUCKET_NAME, or the app bucket
 * until that is set). Only the key is saved in the database; a file is opened
 * through a route that checks the viewer is that landlord or an admin, and then
 * gets a link that works for five minutes. Never sent to Documenso.
 */
import { randomUUID } from "node:crypto";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getBucket, r2 } from "@/lib/r2";
import { changeFileKey, validateChangeFile } from "./changeRequestFileRules";

const bucket = () => process.env.R2_PRIVATE_BUCKET_NAME || getBucket();

// Validates and stores an attachment. Returns what the message row keeps.
export async function storeChangeFile({ userId, bytes, name }) {
  const { ext, contentType, fileName, size } = validateChangeFile({ bytes, name });
  const key = changeFileKey(userId, randomUUID(), ext);
  await r2.send(new PutObjectCommand({ Bucket: bucket(), Key: key, Body: bytes, ContentType: contentType }));
  return { key, fileName, fileType: contentType, fileBytes: size };
}

// A five minute download link.
export function changeFileUrl(key, fileName) {
  return getSignedUrl(
    r2,
    new GetObjectCommand({
      Bucket: bucket(),
      Key: key,
      ResponseContentDisposition: `attachment; filename="${String(fileName || "attachment").replace(/[^\w.-]+/g, "-")}"`,
    }),
    { expiresIn: 300 }
  );
}
