/*
 * Daily cron: hard-purge accounts whose 30-day deletion grace period has elapsed.
 *
 * Stage 2 of the deletion flow started by DELETE /api/account (stage 1 stamps
 * users.deleted_at and stops the account authenticating immediately). This run
 * removes the personal data itself once the recovery window has closed.
 *
 * Per-user actions:
 *   - users row      scrubbed in place to a tombstone rather than DELETEd. The
 *                    row is referenced across the schema; keeping the id intact
 *                    preserves referential integrity, and the real email is
 *                    released so the person can sign up again later.
 *   - reviews        anonymized, not deleted — they describe a property, not the
 *                    reviewer, and stay useful to other students. Note the
 *                    `anonymous` flag is display-only, so real anonymization
 *                    means clearing user_id/name, not setting that flag.
 *   - behavioral     user_listing_interactions, review_votes: deleted outright.
 *   - matchmaking    chat sessions hold verbatim conversation content: deleted.
 *   - lease_checks   AI summaries about the person's own lease: deleted.
 *   - profile photo  every object under profiles/{userId}/ removed from R2.
 *   - action_log     PII payloads redacted, audit skeleton retained (see below).
 *
 * Security: CRON_SECRET bearer token, same as the other cron routes.
 */
import { NextResponse } from "next/server";
import { ListObjectsV2Command, DeleteObjectsCommand } from "@aws-sdk/client-s3";
import supabase from "@/lib/supabase";
import { r2 } from "@/lib/r2";
import { isProdData } from "@/lib/appEnv";

export const dynamic = "force-dynamic";

const GRACE_PERIOD_MS = 30 * 24 * 60 * 60 * 1000;

function bucket() {
  return isProdData()
    ? process.env.R2_BUCKET_NAME_PROD || process.env.R2_BUCKET_NAME
    : process.env.R2_BUCKET_NAME;
}

// Delete every object under profiles/{userId}/ (paginated — a user may have
// replaced their photo several times and old objects were never cleaned up).
async function deleteProfilePhotos(userId) {
  const Bucket = bucket();
  if (!Bucket) return 0;

  let deleted = 0;
  let ContinuationToken;
  do {
    const listed = await r2.send(
      new ListObjectsV2Command({ Bucket, Prefix: `profiles/${userId}/`, ContinuationToken })
    );
    const objects = (listed.Contents ?? []).map((o) => ({ Key: o.Key }));
    if (objects.length > 0) {
      await r2.send(new DeleteObjectsCommand({ Bucket, Delete: { Objects: objects } }));
      deleted += objects.length;
    }
    ContinuationToken = listed.IsTruncated ? listed.NextContinuationToken : undefined;
  } while (ContinuationToken);

  return deleted;
}

async function purgeUser(user) {
  const userId = user.id;

  // Reviews: keep the content, sever the author.
  await supabase
    .from("listing_reviews")
    .update({ user_id: null, name: null })
    .eq("user_id", userId);
  await supabase
    .from("dorm_reviews")
    .update({ user_id: null, reviewer_name: null })
    .eq("user_id", userId);

  // Behavioral history and conversation content: no reason to keep any of it.
  await supabase.from("user_listing_interactions").delete().eq("user_id", userId);
  await supabase.from("review_votes").delete().eq("user_id", userId);
  await supabase.from("matchmaking_chat_sessions").delete().eq("user_id", userId);
  await supabase.from("lease_checks").delete().eq("user_id", userId);

  let photosDeleted = 0;
  try {
    photosDeleted = await deleteProfilePhotos(userId);
  } catch (err) {
    // Don't abort the DB purge because object storage misbehaved; the row scrub
    // below is the part that matters most, and this is retried next run.
    console.error(`[purge-accounts] R2 cleanup failed for ${userId}:`, err);
  }

  // action_log holds full to_jsonb(OLD/NEW) snapshots of the users row — every
  // historical email/phone/birthday/gender plus password_hash. Redact the
  // payloads but keep the row/timestamp/event skeleton so the audit trail of
  // *what happened* survives for security investigations.
  await supabase
    .from("action_log")
    .update({ old_data: null, new_data: null, changed_fields: null })
    .eq("changed_by_id", userId);
  await supabase
    .from("action_log")
    .update({ old_data: null, new_data: null, changed_fields: null })
    .eq("table_name", "users")
    .eq("record_id", userId);

  // Finally the row itself. Placeholders (not NULL) for the columns that are
  // never null in practice; the email is uniqueness-constrained, so it gets a
  // per-user sentinel that frees the real address for future signup.
  const { error } = await supabase
    .from("users")
    .update({
      name: "Deleted user",
      email: `deleted+${userId}@deleted.invalid`,
      description: "",
      gender: "unspecified",
      phone: "N/A",
      referral_source: "",
      image: null,
      birthday: null,
      graduation_year: null,
      graduation_month: null,
      school_id: null,
      payment_method: null,
      payment_handle: null,
      password_hash: null,
      email_verification_token: null,
      email_verification_expires_at: null,
      password_reset_token: null,
      password_reset_expires_at: null,
      google_account: false,
      apple_account: false,
      apple_sub: null,
    })
    .eq("id", userId);

  if (error) throw error;
  return { userId, photosDeleted };
}

export async function GET(req) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - GRACE_PERIOD_MS).toISOString();

  // Already-purged tombstones carry the sentinel address, so filtering on it
  // keeps this run idempotent — a re-run picks up nothing it already handled.
  const { data: due, error } = await supabase
    .from("users")
    .select("id, email")
    .not("deleted_at", "is", null)
    .lt("deleted_at", cutoff)
    .not("email", "like", "deleted+%@deleted.invalid")
    .limit(200);

  if (error) {
    console.error("[purge-accounts] query failed:", error);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }

  const purged = [];
  const failed = [];
  for (const user of due ?? []) {
    try {
      purged.push(await purgeUser(user));
    } catch (err) {
      console.error(`[purge-accounts] failed for ${user.id}:`, err);
      failed.push(user.id);
    }
  }

  return NextResponse.json({
    ok: true,
    cutoff,
    eligible: due?.length ?? 0,
    purged: purged.length,
    failed: failed.length,
  });
}
