/*
 * The half-hour follow-up for a waitlist lead who never finished their account.
 *
 * A student hands over a name to reach a landlord's waitlist, an account is
 * minted from it, and then they spend the next several minutes on Google's form
 * and close the tab. The prompt we showed them is gone and the account is
 * unusable. This is the one message that tells them it exists.
 *
 * The delay is the whole design: mailing immediately would race the student who
 * is still filling in the form and about to come back and finish, and would look
 * automated in the bad way. Thirty minutes is long enough that they are gone.
 *
 * Every lead is stamped once it has been considered, INCLUDING the ones that turn
 * out not to need mailing. A student who finished their account, or who already
 * had one, must not be re-examined by every subsequent run forever.
 */
import supabase from "@/lib/supabase";
import { sendWaitlistNudgeEmail } from "@/lib/email";

export const NUDGE_DELAY_MINUTES = 30;

// One pass should never mail the world. A backlog drains over several runs.
const MAX_PER_RUN = 50;

/**
 * Leads old enough to chase, one per person, oldest first.
 *
 * Deduped by user: someone who clicked Waitlist on three floor plans is one
 * person who needs one email, not three.
 */
export async function waitlistLeadsAwaitingNudge(delayMinutes = NUDGE_DELAY_MINUTES) {
  const cutoff = new Date(Date.now() - delayMinutes * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("waitlist_clicks")
    .select("user_id, name, email")
    .is("nudge_sent_at", null)
    .not("user_id", "is", null)
    .lt("created_at", cutoff)
    .order("created_at", { ascending: true })
    .limit(MAX_PER_RUN * 4);

  if (error) {
    console.error("[waitlistNudge] lead query failed:", error.message);
    return [];
  }

  const byUser = new Map();
  for (const row of data ?? []) {
    if (!byUser.has(row.user_id)) byUser.set(row.user_id, row);
  }
  return [...byUser.values()].slice(0, MAX_PER_RUN);
}

/** Stamp every outstanding click for this person, so they're considered once. */
async function markNudged(userId) {
  const { error } = await supabase
    .from("waitlist_clicks")
    .update({ nudge_sent_at: new Date().toISOString() })
    .eq("user_id", userId)
    .is("nudge_sent_at", null);
  if (error) console.error("[waitlistNudge] stamp failed:", error.message);
}

/**
 * Mail one lead if they still need it. Returns { sent, reason }.
 *
 * Claims the rows BEFORE mailing. A slow send that overlapped the next cron run
 * would otherwise be picked up twice and mailed twice, and a duplicate is worse
 * than a miss for a message this unsolicited.
 */
export async function flushWaitlistNudge({ lead, baseUrl }) {
  const { data: user } = await supabase
    .from("users")
    .select(
      "id, name, email, profile_complete, password_hash, google_account, apple_account, profile_setup_token, profile_setup_expires_at"
    )
    .eq("id", lead.user_id)
    .is("deleted_at", null)
    .maybeSingle();

  if (!user) {
    await markNudged(lead.user_id);
    return { sent: false, reason: "no-account" };
  }

  const hasCredentials =
    !!user.password_hash || !!user.google_account || !!user.apple_account;
  const tokenLive =
    !!user.profile_setup_token &&
    !!user.profile_setup_expires_at &&
    new Date(user.profile_setup_expires_at).getTime() > Date.now();

  /*
   * Nothing to finish, so nothing to say. Credentials mean they can already sign
   * in (they may have had an account all along), and without a live token there
   * is no link to send that would do anything.
   */
  if (user.profile_complete || hasCredentials || !tokenLive) {
    await markNudged(lead.user_id);
    return { sent: false, reason: user.profile_complete || hasCredentials ? "complete" : "no-token" };
  }

  await markNudged(lead.user_id);

  await sendWaitlistNudgeEmail({
    email: user.email,
    name: user.name || lead.name,
    baseUrl,
    setupToken: user.profile_setup_token,
  });

  return { sent: true };
}
