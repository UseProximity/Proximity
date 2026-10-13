/*
 * Reply-by-email runner for local development. DEV-ONLY (returns 403 on staging
 * and production).
 *
 *   POST /api/dev/inbound-email
 *
 * SES stores replies sent to reply-dev.useproximity.org under dev/ in the
 * inbound mail bucket, but SNS cannot reach localhost, so nothing tells the app
 * they arrived. This lists that prefix and runs each new object through the
 * same processInboundEmail the real endpoint uses. Objects already processed
 * are skipped by the same dedupe, so it is safe to call repeatedly.
 *
 * @auth public
 */
import { NextResponse } from "next/server";
import { ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { appEnv } from "@/lib/appEnv";
import { processInboundEmail } from "@/lib/chat/inboundEmail";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST() {
  if (appEnv() !== "development") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const bucket = process.env.AWS_INBOUND_MAIL_BUCKET;
  const s3 = new S3Client({
    region: process.env.AWS_SES_REGION || "us-east-1",
    credentials: {
      accessKeyId: process.env.AWS_SES_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SES_SECRET_ACCESS_KEY,
    },
  });
  const listed = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: "dev/" }));
  const keys = (listed.Contents ?? [])
    .filter((o) => o.Key && !o.Key.endsWith("AMAZON_SES_SETUP_NOTIFICATION"))
    .sort((a, b) => new Date(a.LastModified) - new Date(b.LastModified))
    .map((o) => o.Key);

  const results = [];
  for (const key of keys) {
    const result = await processInboundEmail({ bucket, key });
    if (result.status !== "duplicate") results.push({ key, ...result });
  }
  return NextResponse.json({ processed: results });
}
