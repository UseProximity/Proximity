/*
 * Cloudflare R2 client for listing image storage. R2 is S3-compatible so it uses the AWS
 * SDK's S3Client pointed at the Cloudflare account endpoint. Checksum headers are set to
 * WHEN_REQUIRED because R2 rejects the SDK's default checksum injection during CORS
 * preflight. Used by /api/upload and /api/uploadProfilePhoto to PUT images into the R2
 * bucket; the returned public URL is stored in Supabase as the listing's media reference.
 */
import { S3Client } from "@aws-sdk/client-s3";

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
