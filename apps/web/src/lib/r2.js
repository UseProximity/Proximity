/*
 * Cloudflare R2 client for listing image storage. R2 is S3-compatible so it uses the AWS
 * SDK's S3Client pointed at the Cloudflare account endpoint. Checksum headers are set to
 * WHEN_REQUIRED because R2 rejects the SDK's default checksum injection during CORS
 * preflight. Used by /api/upload and /api/uploadProfilePhoto to PUT images into the R2
 * bucket; the returned public URL is stored in Supabase as the listing's media reference.
 */
import { S3Client } from "@aws-sdk/client-s3";
import { isProdData } from "@/lib/appEnv";

export const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
  // Disable SDK-injected checksum headers — R2 doesn't support them in CORS preflight
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
});

/*
 * Which bucket a request targets. `db` lets an admin tool act against prod
 * explicitly; otherwise it follows the environment, so staging and local write
 * to the dev bucket.
 *
 * These three were copy-pasted into /api/upload, /api/admin/listing-images and
 * lib/streetview.js. Defined once here so a fourth caller — the landlord photo
 * delete — doesn't add a fourth copy that can drift from the others.
 */
export function isProdBucket(db) {
  if (db === "prod") return true;
  if (!db && isProdData()) return true;
  return false;
}

export function getBucket(db) {
  return isProdBucket(db)
    ? process.env.R2_BUCKET_NAME_PROD || process.env.R2_BUCKET_NAME
    : process.env.R2_BUCKET_NAME;
}

// NOTE: the prod variable really is spelled with a lowercase suffix
// (R2_PUBLIC_BASE_URL_prod). Every existing copy reads it that way, so it is
// preserved verbatim — renaming it here would break prod image URLs.
export function getPublicBaseUrl(db) {
  return isProdBucket(db)
    ? process.env.R2_PUBLIC_BASE_URL_prod || process.env.R2_PUBLIC_BASE_URL
    : process.env.R2_PUBLIC_BASE_URL;
}
