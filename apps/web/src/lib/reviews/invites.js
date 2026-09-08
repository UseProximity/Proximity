/*
 * Tokenized review invites: proving a reviewer owns the address they review under.
 *
 * The signed-out review form (the QR flow) asks for a school email and takes the
 * answer on trust, because a student scanning a flyer has no account and asking
 * for one first loses the review. That trust is the hole this closes. An invite
 * is mailed to one address; the token in the link was never anywhere else, so
 * opening it demonstrates control of that inbox. The review then takes its email
 * from the invite row, never from what the browser posts.
 *
 * That is the same proof lib/reviews/onboarding.js already relies on when the
 * profile-setup link marks an account verified. The difference is only WHEN:
 * there the proof arrives after the review, here it arrives before it, which is
 * what lets the resulting account be created already verified.
 *
 * ONLY THE HASH IS STORED. The plaintext token is generated here, returned once
 * to the caller that is about to put it in an email, and never written down.
 * There is no way to read a working link back out of the database, so a dump of
 * review_invites cannot be replayed into a forged review. This is also why
 * tokens are minted at send time: a token that is never sent never exists.
 */
import crypto from "node:crypto";
import supabase from "@/lib/supabase";
import { isReviewEligibleEmail } from "@/lib/schools";

// Long enough for a campaign to run and for reminders to land, short enough that
// a forwarded link does not stay live for a year.
export const INVITE_TTL_DAYS = 30;

/*
 * 32 random bytes, base64url. The token is a URL path segment, so it avoids the
 * padding and slashes plain base64 would produce.
 */
function generateToken() {
  return crypto.randomBytes(32).toString("base64url");
}

/**
 * The only form of a token we ever persist or query by.
 *
 * Exported because the lookup path has to hash before it can search: the
 * plaintext never appears in a WHERE clause, so it never reaches a query log.
 */
export function hashToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

function expiryIso(days = INVITE_TTL_DAYS) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Create an invite and return its plaintext token exactly once.
 *
 * The caller must put the returned token straight into an email and drop it.
 * Nothing else may store it, log it, or return it to a browser.
 *
 * Returns { inviteId, token, email } or { error }.
 */
export async function mintInvite({
  email,
  rosterId = null,
  listingId = null,
  invitedBy = null,
  ttlDays = INVITE_TTL_DAYS,
}) {
  const emailNorm = String(email || "").trim().toLowerCase();

  /*
   * Gate on the school domain here rather than at the send loop. An invite to an
   * address we cannot attribute to a school would mint a token that the review
   * endpoint is then obliged to reject, which is a wasted email and a dead link
   * in someone's inbox.
   */
  if (!isReviewEligibleEmail(emailNorm)) {
    return { error: "That address is not a school email we recognize." };
  }

  const token = generateToken();
  const { data, error } = await supabase
    .from("review_invites")
    .insert({
      token_hash: hashToken(token),
      invited_email: emailNorm,
      roster_id: rosterId,
      listing_id: listingId,
      invited_by: invitedBy,
      expires_at: expiryIso(ttlDays),
    })
    .select("id")
    .maybeSingle();

  if (error || !data?.id) {
    console.error("[reviewInvites] mint failed:", error?.message);
    return { error: "Could not create the invite." };
  }

  return { inviteId: data.id, token, email: emailNorm };
}

/** Stamp an invite as sent. Separate from minting so a send failure leaves it unsent. */
export async function markInviteSent(inviteId) {
  const { error } = await supabase
    .from("review_invites")
    .update({ sent_at: new Date().toISOString() })
    .eq("id", inviteId);
  if (error) console.error("[reviewInvites] mark sent failed:", error.message);
}

/*
 * A minted-but-unsent invite is a dead token: nobody has the link, and leaving
 * the row behind makes the admin list read as though an email went out. Called
 * when the send throws.
 */
export async function discardInvite(inviteId) {
  const { error } = await supabase.from("review_invites").delete().eq("id", inviteId);
  if (error) console.error("[reviewInvites] discard failed:", error.message);
}

/**
 * Resolve a token to the invite it belongs to, with the roster details the form
 * should open pre-filled with.
 *
 * Returns null for anything not currently usable: unknown, expired, or already
 * spent. The caller must not distinguish between those in the UI beyond "this
 * link no longer works", since a precise answer tells a guesser which of their
 * guesses was a real token.
 */
export async function resolveInvite(token) {
  const clean = String(token || "").trim();
  if (!clean) return null;

  const { data: invite } = await supabase
    .from("review_invites")
    .select(
      "id, invited_email, listing_id, roster_id, expires_at, used_at, student_roster(first_name, last_name, class_year)"
    )
    .eq("token_hash", hashToken(clean))
    .maybeSingle();

  if (!invite) return null;
  if (invite.used_at) return null;
  if (new Date(invite.expires_at).getTime() < Date.now()) return null;

  const roster = invite.student_roster || null;
  return {
    inviteId: invite.id,
    email: invite.invited_email,
    listingId: invite.listing_id,
    rosterId: invite.roster_id,
    expiresAt: invite.expires_at,
    /*
     * Prefill only. Everything here is editable by the reviewer except the
     * email, which is the one field the token actually vouches for.
     */
    prefill: {
      firstName: roster?.first_name || "",
      lastName: roster?.last_name || "",
      classYear: roster?.class_year ? String(roster.class_year) : "",
      email: invite.invited_email,
    },
  };
}

/**
 * Spend the invite and record what it produced.
 *
 * Guarded on used_at being null so two submissions racing the same link can only
 * ever burn it once. Returns true when this call is the one that spent it.
 */
export async function consumeInvite(inviteId, { reviewId = null, reviewKind = null } = {}) {
  const { data, error } = await supabase
    .from("review_invites")
    .update({
      used_at: new Date().toISOString(),
      review_id: reviewId,
      review_kind: reviewKind,
    })
    .eq("id", inviteId)
    .is("used_at", null)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[reviewInvites] consume failed:", error.message);
    return false;
  }
  return !!data?.id;
}
