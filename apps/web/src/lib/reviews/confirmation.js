/*
 * Batched "your review is live" confirmations.
 *
 * A review no longer emails the reviewer the instant it posts. Instead every
 * review starts life with confirmation_sent_at = null, and the confirmation is
 * flushed once per REVIEWER — not once per review — at whichever of these
 * comes first:
 *
 *   - they leave the review loop ("no thanks", or they finish their profile),
 *     which calls flushReviewConfirmation() through /api/reviews/confirm;
 *   - the 30-minute sweep in /api/cron/review-confirmations picks them up,
 *     for everyone who just closed the tab.
 *
 * So a student who reviews three places gets one email naming all three,
 * whether they exited cleanly or walked away.
 *
 * confirmation_sent_at is the idempotency key. Rows are claimed by stamping it
 * BEFORE the mail goes out and only where it is still null, so an explicit
 * flush racing the sweep (or two overlapping cron runs) can only ever have one
 * winner — the loser claims zero rows and sends nothing. The trade is that a
 * mail failure after a successful claim loses that confirmation rather than
 * risking a duplicate; the review itself is already safely posted, and a
 * student being emailed twice about the same review is the worse outcome.
 */
import supabase from "@/lib/supabase";
import { listingPlaceName } from "./placeName";
import { sendReviewConfirmationEmail } from "@/lib/email";

/** How long a reviewer gets to add another review before we send anyway. */
export const CONFIRMATION_DELAY_MINUTES = 30;

/**
 * Reviews by this user that have not been confirmed yet, newest first, with a
 * display name for each place. Returns [] when there is nothing to send.
 */
async function pendingReviews(userId) {
  const [{ data: listingRows }, { data: dormRows }] = await Promise.all([
    supabase
      .from("listing_reviews")
      .select("id, created_at, listings!listing_id(title, address)")
      .eq("user_id", userId)
      .is("confirmation_sent_at", null)
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),
    supabase
      .from("dorm_reviews")
      .select("id, created_at, dorms!dorm_id(name)")
      .eq("user_id", userId)
      .is("confirmation_sent_at", null)
      .order("created_at", { ascending: false }),
  ]);

  return [
    ...(listingRows ?? []).map((r) => ({
      table: "listing_reviews",
      id: r.id,
      createdAt: r.created_at,
      place: listingPlaceName(r.listings),
    })),
    ...(dormRows ?? []).map((r) => ({
      table: "dorm_reviews",
      id: r.id,
      createdAt: r.created_at,
      place: r.dorms?.name || "your dorm",
    })),
  ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

/*
 * Claim rows by stamping confirmation_sent_at, and report which claims stuck.
 * The `.is(..., null)` guard is what makes this a claim rather than a write:
 * a row another caller already took updates zero rows and comes back absent.
 */
async function claim(reviews, stampedAt) {
  const claimed = [];
  for (const table of ["listing_reviews", "dorm_reviews"]) {
    const ids = reviews.filter((r) => r.table === table).map((r) => r.id);
    if (!ids.length) continue;
    const { data, error } = await supabase
      .from(table)
      .update({ confirmation_sent_at: stampedAt })
      .in("id", ids)
      .is("confirmation_sent_at", null)
      .select("id");
    if (error) {
      console.error(`[reviewConfirmation] claim on ${table} failed:`, error.message);
      continue;
    }
    const won = new Set((data ?? []).map((r) => r.id));
    claimed.push(...reviews.filter((r) => r.table === table && won.has(r.id)));
  }
  return claimed;
}

/** Undo a claim, so a send that never happened can be retried by the sweep. */
async function release(reviews) {
  for (const table of ["listing_reviews", "dorm_reviews"]) {
    const ids = reviews.filter((r) => r.table === table).map((r) => r.id);
    if (!ids.length) continue;
    const { error } = await supabase
      .from(table)
      .update({ confirmation_sent_at: null })
      .in("id", ids);
    if (error) console.error(`[reviewConfirmation] release on ${table} failed:`, error.message);
  }
}

/**
 * Send one confirmation covering every unconfirmed review by this user.
 *
 * The account state decides what the email says, read at send time rather than
 * at review time: a student who finished their profile in the 30-minute window
 * must not be emailed a setup link that completing the profile already burned.
 *
 * Returns { sent, places, reason } — sent:false with a reason when there was
 * nothing to do, which is the common case and not an error.
 */
export async function flushReviewConfirmation({ userId, baseUrl }) {
  if (!userId) return { sent: false, reason: "no_user" };

  const pending = await pendingReviews(userId);
  if (!pending.length) return { sent: false, reason: "nothing_pending" };

  const { data: user } = await supabase
    .from("users")
    .select("email, name, profile_complete, profile_setup_token, profile_setup_expires_at")
    .eq("id", userId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!user?.email) return { sent: false, reason: "no_email" };

  // Only offer the profile step to an account that still has one to finish and
  // a token that is actually live — otherwise the email ships a dead link.
  const setupLive =
    !user.profile_complete &&
    !!user.profile_setup_token &&
    !!user.profile_setup_expires_at &&
    new Date(user.profile_setup_expires_at).getTime() > Date.now();

  const claimed = await claim(pending, new Date().toISOString());
  if (!claimed.length) return { sent: false, reason: "already_claimed" };

  // De-duplicate place names: two reviews of the same building read as one
  // place in a sentence, even though both rows are confirmed.
  const places = [...new Set(claimed.map((r) => r.place))];

  try {
    await sendReviewConfirmationEmail({
      email: user.email,
      name: user.name,
      baseUrl,
      places,
      setupToken: setupLive ? user.profile_setup_token : null,
    });
  } catch (err) {
    console.error("[reviewConfirmation] send failed:", err?.message);
    await release(claimed);
    return { sent: false, reason: "send_failed" };
  }

  return { sent: true, places, count: claimed.length };
}

/**
 * Reviewers whose oldest unconfirmed review is older than the delay — i.e. who
 * left without ever telling us they were done. Used by the cron sweep.
 */
export async function reviewersAwaitingConfirmation(delayMinutes = CONFIRMATION_DELAY_MINUTES) {
  const cutoff = new Date(Date.now() - delayMinutes * 60 * 1000).toISOString();
  const [{ data: listingRows }, { data: dormRows }] = await Promise.all([
    supabase
      .from("listing_reviews")
      .select("user_id")
      .is("confirmation_sent_at", null)
      .is("deleted_at", null)
      .lt("created_at", cutoff),
    supabase
      .from("dorm_reviews")
      .select("user_id")
      .is("confirmation_sent_at", null)
      .lt("created_at", cutoff),
  ]);
  return [
    ...new Set(
      [...(listingRows ?? []), ...(dormRows ?? [])].map((r) => r.user_id).filter(Boolean)
    ),
  ];
}
