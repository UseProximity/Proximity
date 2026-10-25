/*
 * Redeems an email-verification token. Shared by GET (the web link) and POST (the mobile
 * app) in api/auth/verify-email, which differ only in how they answer.
 *
 * Resolves to { status: "ok" } only once the verification is persisted, { status:
 * "invalid" } for a token that is unknown, used or expired, and { status: "error" } for a
 * database failure, which the caller should treat as retryable. `db` is the Supabase
 * client, passed in so the logic can be tested without one.
 */
export async function redeemVerificationToken(db, token) {
  const now = new Date().toISOString();
  const { data: user, error } = await db
    .from("users")
    .select("id")
    .eq("email_verification_token", token)
    .eq("email_verified", false)
    .gt("email_verification_expires_at", now)
    .maybeSingle();

  if (error) return { status: "error", error };
  if (!user) return { status: "invalid" };

  // Guarded by the token again so two requests racing on one link cannot both succeed:
  // only the one that actually changed a row is told it worked.
  const { data: updated, error: updateError } = await db
    .from("users")
    .update({
      email_verified: true,
      email_verification_token: null,
      email_verification_expires_at: null,
    })
    .eq("id", user.id)
    .eq("email_verification_token", token)
    .eq("email_verified", false)
    .gt("email_verification_expires_at", now)
    .select("id");

  if (updateError) return { status: "error", error: updateError };
  if (!updated || updated.length === 0) return { status: "invalid" };
  return { status: "ok" };
}
