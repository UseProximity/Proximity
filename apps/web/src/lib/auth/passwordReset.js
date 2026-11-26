/*
 * Mint a password-reset token and email the link. Shared by the forgot-password
 * form and the review-invite path, which wipes an unproven password when the
 * inbox owner shows up and has to hand them a way back in.
 *
 * Only the hash is stored (see lib/auth/tokenHash.js); the raw token exists in
 * the email alone. Returns true once the email was handed off.
 */
import supabase from "@/lib/supabase";
import { hashToken } from "@/lib/auth/tokenHash";
import { getBaseUrl, sendPasswordResetEmail } from "@/lib/email";

const RESET_TTL_MS = 60 * 60 * 1000;

/*
 * A set-password link for an account that has never had a way to sign in, for an
 * admin mass email (lib/massEmail/send.js). It lasts longer than a reset link
 * because the email may sit unread for days. Minting a new one replaces any
 * earlier link, so only the newest email's button works. Returns the URL, or null
 * when the token could not be stored.
 */
export const SETUP_LINK_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export async function mintPasswordSetupUrl(userId, { db = supabase, baseUrl = getBaseUrl(), now = Date.now() } = {}) {
  const token = crypto.randomUUID();
  const { error } = await db
    .from("users")
    .update({
      password_reset_token: hashToken(token),
      password_reset_expires_at: new Date(now + SETUP_LINK_TTL_MS).toISOString(),
    })
    .eq("id", userId);
  if (error) {
    console.error("[passwordReset] store setup token failed:", error.message);
    return null;
  }
  return `${baseUrl}/reset-password?token=${token}`;
}

export async function sendPasswordReset({ userId, email, name = null, req = null }) {
  const token = crypto.randomUUID();
  const { error } = await supabase
    .from("users")
    .update({
      password_reset_token: hashToken(token),
      password_reset_expires_at: new Date(Date.now() + RESET_TTL_MS).toISOString(),
    })
    .eq("id", userId);
  if (error) {
    console.error("[passwordReset] store token failed:", error.message);
    return false;
  }

  await sendPasswordResetEmail({ email, name, token, baseUrl: getBaseUrl(), req });
  return true;
}
