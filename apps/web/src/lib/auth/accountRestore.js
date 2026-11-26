/*
 * Restoring a deleted account inside its 30-day grace period.
 *
 * DELETE /api/account only stamps users.deleted_at; the hard purge waits 30 days
 * (api/cron/purge-accounts). Until then nothing is gone, so signing back in
 * offers to bring the account back: the sign-in proves who they are, a confirm
 * screen asks, and POST /api/auth/restore-account clears the stamp.
 *
 * Two ways in, because the two sign-in methods prove identity differently:
 *   password  the restore request carries the email and password again and is
 *             checked exactly as sign-in checks them (throttle included).
 *   Google    the OAuth round trip is the proof, so auth.js's signIn callback
 *             hands the login page a short-lived signed token instead
 *             (signRestoreToken), and the restore request carries that.
 *
 * Neither ever confirms a deletion to someone who hasn't proved the account is
 * theirs: a wrong password on a deleted account fails like any wrong password.
 */
import crypto from "crypto";
import bcrypt from "bcryptjs";
import supabase from "@/lib/supabase";
import { emailMatchPattern } from "@/lib/auth/email";
import { updateAsUser } from "@/lib/supabaseWithUser";

const DAY_MS = 24 * 60 * 60 * 1000;
// Shared with the purge cron so "can still restore" and "about to be purged"
// can never disagree.
export const ACCOUNT_GRACE_PERIOD_MS = 30 * DAY_MS;

// Long enough to read the confirm screen, short enough that a token lifted
// from a login URL is soon worthless.
const TOKEN_TTL_SECONDS = 15 * 60;
const TOKEN_PURPOSE = "account_restore";

export function restoreDeadline(deletedAt) {
  return new Date(new Date(deletedAt).getTime() + ACCOUNT_GRACE_PERIOD_MS);
}

export function isRestorable(user, now = Date.now()) {
  if (!user?.deleted_at) return false;
  return now < restoreDeadline(user.deleted_at).getTime();
}

function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET must be set");
  return s;
}

const hmac = (payload) => crypto.createHmac("sha256", secret()).update(payload).digest("base64url");

export function signRestoreToken(userId, now = Date.now()) {
  const payload = Buffer.from(
    JSON.stringify({ p: TOKEN_PURPOSE, u: userId, exp: Math.floor(now / 1000) + TOKEN_TTL_SECONDS })
  ).toString("base64url");
  return `${payload}.${hmac(payload)}`;
}

// Returns the user id, or null (bad signature / malformed / expired / wrong purpose).
export function verifyRestoreToken(token, now = Date.now()) {
  if (typeof token !== "string" || token.length > 500) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const a = Buffer.from(sig);
  const b = Buffer.from(hmac(payload));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (data?.p !== TOKEN_PURPOSE || !data.u || typeof data.exp !== "number") return null;
    if (data.exp * 1000 < now) return null;
    return data.u;
  } catch {
    return null;
  }
}

const USER_SELECT = "id, email, password_hash, email_verified, deleted_at, is_system";

/*
 * The deleted account behind an email and password, or null. Null covers every
 * failure alike (unknown email, wrong password, not deleted, past the window)
 * so the caller can't tell them apart either.
 */
export async function findRestorableByPassword(email, password) {
  if (!email || !password) return null;
  const { data: user } = await supabase
    .from("users")
    .select(USER_SELECT)
    .ilike("email", emailMatchPattern(email))
    .single();
  if (!user?.password_hash || !user.email_verified || !isRestorable(user)) return null;
  if (!(await bcrypt.compare(password, user.password_hash))) return null;
  return user;
}

export async function findRestorableById(userId) {
  if (!userId) return null;
  const { data: user } = await supabase.from("users").select(USER_SELECT).eq("id", userId).single();
  return isRestorable(user) ? user : null;
}

/*
 * Bring the account back, along with the listings its deletion took down.
 *
 * fn_handle_user_soft_delete stamps each sole-owned listing with the account's
 * own deleted_at, so a listing carrying exactly that timestamp went with the
 * account and comes back with it. One the person deleted themselves earlier has
 * a different stamp and stays deleted. Co-owned listings were handed to the
 * co-owner at deletion and stay theirs.
 *
 * Returns { ok, listingsRestored }.
 */
export async function restoreAccount(user) {
  const deletedAt = new Date(user.deleted_at).getTime();

  const { error } = await updateAsUser(supabase, {
    userId: user.id,
    table: "users",
    rowId: user.id,
    data: { deleted_at: null },
  });
  if (error) {
    console.error("[accountRestore] restore failed:", error.message);
    return { ok: false, listingsRestored: 0 };
  }

  // The account is back either way; a listing that fails to come back is
  // something they can see on their dashboard and ask us about.
  let listingsRestored = 0;
  const { data: links } = await supabase
    .from("listing_landlords")
    .select("listing_id")
    .eq("user_id", user.id);
  const ids = (links ?? []).map((l) => l.listing_id);
  if (ids.length) {
    const { data: listings } = await supabase
      .from("listings")
      .select("id, deleted_at")
      .in("id", ids)
      .not("deleted_at", "is", null);
    for (const listing of listings ?? []) {
      if (new Date(listing.deleted_at).getTime() !== deletedAt) continue;
      const { error: listingErr } = await updateAsUser(supabase, {
        userId: user.id,
        table: "listings",
        rowId: listing.id,
        data: { deleted_at: null },
      });
      if (listingErr) console.error("[accountRestore] listing restore failed:", listingErr.message);
      else listingsRestored += 1;
    }
  }

  return { ok: true, listingsRestored };
}
