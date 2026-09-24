/*
 * Hourly cron: delete abandoned Lease Check uploads.
 *
 * A lease is uploaded straight to R2 under lease-checks/tmp/ and deleted by the
 * analysis request (PUT /api/lease-check) in its finally block. If that request
 * never runs, for example because the student closed the tab after the upload,
 * nothing else removed the file. This job is that backstop, and it is what the
 * Privacy Policy s1.7 and s9 promise ("within 24 hours").
 *
 * Anything under the prefix older than STALE_AFTER_MS is deleted. An analysis
 * finishes inside the route's 300s cap, so an hour-old object is never in use.
 *
 * Both buckets are swept: crons only run on the production deployment, and
 * staging and local uploads land in the dev bucket, which would otherwise have
 * no cleanup at all.
 *
 * Security: CRON_SECRET bearer token, same as the other cron routes.
 */
import { NextResponse } from "next/server";
import { ListObjectsV2Command, DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { r2 } from "@/lib/r2";

export const dynamic = "force-dynamic";

const PREFIX = "lease-checks/tmp/";
const STALE_AFTER_MS = 60 * 60 * 1000;

async function sweepBucket(bucket, cutoff) {
  let deleted = 0;
  let token;
  do {
    const page = await r2.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: PREFIX, ContinuationToken: token })
    );
    const stale = (page.Contents ?? []).filter(
      (o) => o.Key?.startsWith(PREFIX) && o.LastModified && o.LastModified.getTime() < cutoff
    );
    if (stale.length > 0) {
      const res = await r2.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: stale.map((o) => ({ Key: o.Key })), Quiet: true },
        })
      );
      if (res.Errors?.length) {
        throw new Error(`${res.Errors.length} delete(s) failed in ${bucket}: ${res.Errors[0].Message}`);
      }
      deleted += stale.length;
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return deleted;
}

export async function GET(req) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const buckets = [
    ...new Set([process.env.R2_BUCKET_NAME_PROD, process.env.R2_BUCKET_NAME].filter(Boolean)),
  ];
  const cutoff = Date.now() - STALE_AFTER_MS;

  const results = {};
  let failed = false;
  for (const bucket of buckets) {
    try {
      results[bucket] = await sweepBucket(bucket, cutoff);
    } catch (err) {
      failed = true;
      console.error(`[cron/lease-check-cleanup] ${bucket}:`, err.message);
      results[bucket] = "error";
    }
  }

  console.log("[cron/lease-check-cleanup] deleted:", results);
  return NextResponse.json({ ok: !failed, deleted: results }, { status: failed ? 500 : 200 });
}
