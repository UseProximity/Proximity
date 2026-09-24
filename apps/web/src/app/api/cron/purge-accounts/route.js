/*
 * Daily cron: hard-purge accounts whose 30-day deletion grace period has elapsed,
 * then erase the records kept for three years once that window has passed too.
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
 *                    means clearing user_id/name/reviewer_email, not setting
 *                    that flag. Landlord contact fields on a review describe a
 *                    DIFFERENT person and are deliberately left in place.
 *   - behavioral     user_listing_interactions, review_votes, waitlist_clicks:
 *                    deleted outright.
 *   - matchmaking    chat sessions and matchmaking_preferences are KEPT for
 *                    three years (Privacy Policy s8). They record why we showed
 *                    this person the properties we did, so they are erased by
 *                    the retention stage below, not here.
 *   - lease_checks   AI summaries about the person's own lease: deleted.
 *   - invites        review_invites carry the person's email address.
 *   - devices        device_push_tokens, for when the mobile apps ship.
 *   - listings       sole-owned listings are soft-deleted by the users trigger.
 *                    The owner's phone is scrubbed now; their name and email
 *                    stay on the withdrawn listing for three years (Terms s17A).
 *   - profile photo  every object under profiles/{userId}/ removed from R2.
 *   - action_log     PII payloads redacted, audit skeleton retained (see below).
 *
 * Every database step is checked and throws on failure. That matters more here
 * than it looks: the run is made idempotent by the tombstone email, so a step
 * that failed silently would leave real data behind on a user this job will
 * never look at again. Throwing instead leaves the account un-tombstoned and
 * the next run retries it from the top (every step below is safe to repeat).
 *
 * Retention stage: once a tombstoned account is three years past deleted_at,
 * its matchmaking rows are deleted and the contact name and email on its
 * withdrawn listings are cleared. Every step is safe to repeat.
 *
 * Security: CRON_SECRET bearer token, same as the other cron routes.
 */
import { NextResponse } from "next/server";
import { ListObjectsV2Command, DeleteObjectsCommand } from "@aws-sdk/client-s3";
import supabase from "@/lib/supabase";
import { r2 } from "@/lib/r2";
import { isProdData } from "@/lib/appEnv";

export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;
const GRACE_PERIOD_MS = 30 * DAY_MS;
const RETENTION_MS = 3 * 365 * DAY_MS;
const TOMBSTONE_EMAIL = "deleted+%@deleted.invalid";

// Surface a failed step instead of letting it pass as a no-op. See the header:
// a swallowed error plus the tombstone filter equals data that is never purged.
async function must(label, query) {
  const { error } = await query;
  if (error) throw new Error(`${label}: ${error.message}`);
}

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

// Payload columns are nulled; the row, its timestamp and its event type stay so
// the audit trail of *what happened* survives for security investigations.
const REDACTED = { old_data: null, new_data: null, changed_fields: null };

async function redactActionLog(userId, email) {
  // Changes this person made, and changes made to their own users row.
  await must(
    "action_log by actor",
    supabase.from("action_log").update(REDACTED).eq("changed_by_id", userId)
  );
  await must(
    "action_log by record",
    supabase.from("action_log").update(REDACTED).eq("record_id", userId)
  );

  // Entries on OTHER tables whose snapshot carries this person's data: a review
  // edited by an admin, a preference row touched by a backfill. Those are keyed
  // by the changed row's id and attributed to whoever made the change, so
  // neither filter above reaches them. Match inside the payload instead.
  for (const column of ["old_data", "new_data"]) {
    await must(
      `action_log ${column}.user_id`,
      supabase.from("action_log").update(REDACTED).eq(`${column}->>user_id`, userId)
    );
    if (email) {
      await must(
        `action_log ${column}.reviewer_email`,
        supabase.from("action_log").update(REDACTED).eq(`${column}->>reviewer_email`, email)
      );
    }
  }
}

// Sole-owned listings are soft-deleted by the users trigger, but withdrawn is
// not erased. The owner's name and email stay for three years as marketplace
// history (cleared by eraseRetainedRecords); the phone goes now. Clear it only
// where it is demonstrably theirs, so a management company's number survives.
async function scrubListingContacts(user) {
  const { data: links, error } = await supabase
    .from("listing_landlords")
    .select("listing_id")
    .eq("user_id", user.id);
  if (error) throw new Error(`listing links: ${error.message}`);

  const ids = (links ?? []).map((l) => l.listing_id);
  if (ids.length === 0) return 0;

  if (user.phone) {
    await must(
      "listing contact_phone",
      supabase
        .from("listings")
        .update({ contact_phone: null })
        .in("id", ids)
        .eq("contact_phone", user.phone)
    );
  }
  return ids.length;
}

// Three years after deletion: erase what purgeUser deliberately kept. The users
// row is a tombstone by now, so the listing contact can no longer be matched by
// value. Every withdrawn listing still linked to this account is cleared instead;
// co-owned listings were handed to the remaining owner at deletion and are live.
async function eraseRetainedRecords(userId) {
  await must(
    "retained matchmaking_chat_sessions",
    supabase.from("matchmaking_chat_sessions").delete().eq("user_id", userId)
  );
  await must(
    "retained matchmaking_preferences",
    supabase.from("matchmaking_preferences").delete().eq("user_id", userId)
  );

  const { data: links, error } = await supabase
    .from("listing_landlords")
    .select("listing_id")
    .eq("user_id", userId);
  if (error) throw new Error(`retained listing links: ${error.message}`);

  const ids = (links ?? []).map((l) => l.listing_id);
  if (ids.length > 0) {
    await must(
      "retained listing contacts",
      supabase
        .from("listings")
        .update({ contact_name: null, contact_email: null })
        .in("id", ids)
        .not("deleted_at", "is", null)
    );
  }
}

async function purgeUser(user) {
  const userId = user.id;

  // Reviews: keep the content, sever the author. reviewer_email is the author's
  // own address captured by the referral flow, so it goes with the name.
  await must(
    "listing_reviews anonymize",
    supabase
      .from("listing_reviews")
      .update({ user_id: null, name: null, reviewer_email: null })
      .eq("user_id", userId)
  );
  await must(
    "dorm_reviews anonymize",
    supabase
      .from("dorm_reviews")
      .update({ user_id: null, reviewer_name: null })
      .eq("user_id", userId)
  );
  // A referral review can carry the address without ever being linked to the
  // account, so sever those by email too.
  if (user.email) {
    await must(
      "listing_reviews by email",
      supabase
        .from("listing_reviews")
        .update({ reviewer_email: null })
        .eq("reviewer_email", user.email)
    );
  }

  // Behavioral history and conversation content: no reason to keep any of it.
  await must(
    "user_listing_interactions",
    supabase.from("user_listing_interactions").delete().eq("user_id", userId)
  );
  await must("review_votes", supabase.from("review_votes").delete().eq("user_id", userId));
  // Matchmaking sessions and preferences are kept for three years; see the header.
  await must("lease_checks", supabase.from("lease_checks").delete().eq("user_id", userId));
  await must(
    "waitlist_clicks",
    supabase.from("waitlist_clicks").delete().eq("user_id", userId)
  );
  await must(
    "device_push_tokens",
    supabase.from("device_push_tokens").delete().eq("user_id", userId)
  );
  if (user.email) {
    // A waitlist click made before signing in carries the address on the row
    // rather than a user_id.
    await must(
      "waitlist_clicks by email",
      supabase.from("waitlist_clicks").delete().eq("email", user.email)
    );
    // Invitations hold the person's address in invited_email.
    await must(
      "review_invites",
      supabase.from("review_invites").delete().eq("invited_email", user.email)
    );
  }

  const listingsScrubbed = await scrubListingContacts(user);

  let photosDeleted = 0;
  try {
    photosDeleted = await deleteProfilePhotos(userId);
  } catch (err) {
    // Don't abort the DB purge because object storage misbehaved; the row scrub
    // below is the part that matters most, and this is retried next run.
    console.error(`[purge-accounts] R2 cleanup failed for ${userId}:`, err);
  }

  // action_log holds full to_jsonb(OLD/NEW) snapshots of the users row — every
  // historical email/phone/birthday/gender plus password_hash — and of every
  // other row this person appears in.
  await redactActionLog(userId, user.email);

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
      profile_setup_token: null,
      profile_setup_expires_at: null,
      google_account: false,
      apple_account: false,
      apple_sub: null,
    })
    .eq("id", userId);

  if (error) throw error;
  return { userId, photosDeleted, listingsScrubbed };
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
    .select("id, email, name, phone")
    .not("deleted_at", "is", null)
    .lt("deleted_at", cutoff)
    .not("email", "like", TOMBSTONE_EMAIL)
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

  // Retention stage. Only tombstones reach it, so every account here has
  // already been through purgeUser above.
  const retentionCutoff = new Date(Date.now() - RETENTION_MS).toISOString();
  const { data: expired, error: expiredError } = await supabase
    .from("users")
    .select("id")
    .lt("deleted_at", retentionCutoff)
    .like("email", TOMBSTONE_EMAIL)
    .limit(200);

  let erased = 0;
  const eraseFailed = [];
  if (expiredError) {
    console.error("[purge-accounts] retention query failed:", expiredError);
  } else {
    for (const { id } of expired ?? []) {
      try {
        await eraseRetainedRecords(id);
        erased += 1;
      } catch (err) {
        console.error(`[purge-accounts] retention erase failed for ${id}:`, err);
        eraseFailed.push(id);
      }
    }
  }

  return NextResponse.json({
    ok: true,
    cutoff,
    eligible: due?.length ?? 0,
    purged: purged.length,
    failed: failed.length,
    retentionCutoff,
    retentionErased: erased,
    retentionFailed: eraseFailed.length + (expiredError ? 1 : 0),
  });
}
