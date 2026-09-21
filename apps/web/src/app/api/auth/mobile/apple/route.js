import supabase from "@/lib/supabase";
import { signAccessToken, signRefreshToken, buildUserPayload } from "@/lib/authMobile";
import { AppleTokenError, verifyAppleIdentityToken, exchangeAuthorizationCode } from "@/lib/appleAuth";
import { AUTH_ERRORS } from "@proximity/auth-core";

const USER_SELECT = "id, email, name, image, profile_complete, deleted_at, roles!role_id(name)";

// Apple sends boolean-like claims as either true or "true".
const isTrue = (value) => value === true || value === "true";

// Apple puts the name in the sign-in sheet, not in the identity token, and only
// on a user's first authorization, so it arrives from the client. Untrusted.
function displayName(fullName) {
  return [fullName?.givenName, fullName?.familyName]
    .filter((part) => typeof part === "string")
    .join(" ")
    .replace(/[\p{Cc}<>]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
}

export async function POST(req) {
  try {
    const { identityToken, authorizationCode, nonce, fullName } = await req.json();

    if (typeof identityToken !== "string" || typeof nonce !== "string" || !identityToken || !nonce) {
      return Response.json({ error: AUTH_ERRORS.MISSING_FIELDS }, { status: 400 });
    }

    let claims;
    try {
      claims = await verifyAppleIdentityToken(identityToken, nonce);
    } catch (err) {
      if (!(err instanceof AppleTokenError)) throw err;
      console.error("mobile/apple: identity token rejected:", err.message);
      return Response.json({ error: AUTH_ERRORS.INVALID_TOKEN }, { status: 401 });
    }
    const appleSub = claims.sub;
    const email = claims.email;
    const isPrivateRelay = isTrue(claims.is_private_email);

    // apple_sub is the identity. Apple only sends the email on the first
    // authorization and it can be a private relay address, so once a user is
    // known by sub the email is never consulted.
    const { data: bySub, error: subError } = await supabase
      .from("users")
      .select(USER_SELECT)
      .eq("apple_sub", appleSub)
      .maybeSingle();
    if (subError) throw subError;

    let userRow = bySub;
    if (userRow?.deleted_at) {
      return Response.json({ error: AUTH_ERRORS.ACCOUNT_DELETED }, { status: 403 });
    }

    if (!userRow) {
      // Without an address Apple has verified there is nothing to create the
      // account with (Apple School Manager accounts can have no email at all).
      if (!email || !isTrue(claims.email_verified)) {
        return Response.json({ error: AUTH_ERRORS.APPLE_EMAIL_REQUIRED }, { status: 400 });
      }

      // A "Hide My Email" relay address is unique to this Apple user and can
      // never equal an existing account's address, so it skips the match.
      // A real address is linked to the existing account only when that
      // account's email is itself verified (a Google account, or a password
      // account that confirmed its email). An unverified one is refused, so
      // whoever registered the address first can't be inherited by the owner.
      if (!isPrivateRelay) {
        const { data: existing, error: existingError } = await supabase
          .from("users")
          .select(`${USER_SELECT}, email_verified, google_account`)
          .eq("email", email)
          .maybeSingle();
        if (existingError) throw existingError;

        if (existing?.deleted_at) {
          return Response.json({ error: AUTH_ERRORS.ACCOUNT_DELETED }, { status: 403 });
        }
        if (existing) {
          if (!existing.google_account && !existing.email_verified) {
            return Response.json({ error: AUTH_ERRORS.EMAIL_NOT_VERIFIED }, { status: 403 });
          }
          const { error: linkError } = await supabase
            .from("users")
            .update({ apple_sub: appleSub, apple_account: true })
            .eq("id", existing.id);
          if (linkError) throw linkError;
          userRow = existing;
        }
      }
    }

    if (!userRow) {
      const { data: studentRole } = await supabase
        .from("roles")
        .select("id")
        .eq("name", "student")
        .single();

      const { data: newUser, error: insertError } = await supabase
        .from("users")
        .insert({
          email,
          name: displayName(fullName) || (!isPrivateRelay && email.split("@")[0]) || "New User",
          image: null,
          role_id: studentRole?.id,
          profile_complete: false,
          email_verified: true,
          apple_account: true,
          apple_sub: appleSub,
          gender: "unspecified",
          phone: "N/A",
          description: "",
          referral_source: "",
        })
        .select(USER_SELECT)
        .single();

      if (insertError) {
        // Two first sign-ins racing: the unique apple_sub index rejects the
        // second insert, so carry on with the row the first one created.
        const { data: winner } =
          insertError.code === "23505"
            ? await supabase.from("users").select(USER_SELECT).eq("apple_sub", appleSub).maybeSingle()
            : { data: null };
        if (!winner) {
          console.error("mobile/apple: insert error", insertError);
          return Response.json({ error: AUTH_ERRORS.SERVER_ERROR }, { status: 500 });
        }
        userRow = winner;
      } else {
        userRow = newUser;
      }
    }

    // Kept only so account deletion can revoke the user's Apple grant. Best
    // effort: a failed exchange must not block signing in.
    if (typeof authorizationCode === "string" && authorizationCode) {
      const appleRefreshToken = await exchangeAuthorizationCode(authorizationCode, appleSub);
      if (appleRefreshToken) {
        const { error: tokenError } = await supabase
          .from("users")
          .update({ apple_refresh_token: appleRefreshToken })
          .eq("id", userRow.id);
        if (tokenError) console.error("mobile/apple: could not store refresh token", tokenError);
      }
    }

    const [accessToken, refreshToken] = await Promise.all([
      signAccessToken({
        id: userRow.id,
        role: userRow.roles?.name ?? "student",
        profileComplete: userRow.profile_complete ?? false,
      }),
      signRefreshToken({ id: userRow.id }),
    ]);

    return Response.json({ accessToken, refreshToken, user: buildUserPayload(userRow) });
  } catch (err) {
    console.error("mobile/apple error:", err);
    return Response.json({ error: AUTH_ERRORS.SERVER_ERROR }, { status: 500 });
  }
}
