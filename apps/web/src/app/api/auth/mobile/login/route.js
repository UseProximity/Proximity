import bcrypt from "bcryptjs";
import supabase from "@/lib/supabase";
import { signAccessToken, signRefreshToken, buildUserPayload } from "@/lib/authMobile";
import { AUTH_ERRORS } from "@proximity/auth-core";
import { emailMatchPattern, normalizeEmail } from "@/lib/auth/email";
import {
  checkLoginLock,
  recordLoginFailure,
  recordLoginSuccess,
  clientIp,
} from "@/lib/auth/loginThrottle";

export async function POST(req) {
  try {
    const { email: rawEmail, password } = await req.json();
    const email = normalizeEmail(rawEmail);

    if (!email || !password) {
      return Response.json({ error: AUTH_ERRORS.MISSING_FIELDS }, { status: 400 });
    }

    // Checked before any DB lookup so a locked unknown email and a locked real
    // one get the same response. See lib/auth/loginThrottle.js.
    const who = { email, ip: clientIp(req.headers) };
    const lock = checkLoginLock(who);
    if (lock.locked) {
      return Response.json(
        {
          error: AUTH_ERRORS.TOO_MANY_ATTEMPTS,
          message: "Too many failed sign-in attempts. Please try again later.",
          retryAfterSeconds: lock.retryAfterSec,
        },
        { status: 429, headers: { "Retry-After": String(lock.retryAfterSec) } }
      );
    }

    const { data: user } = await supabase
      .from("users")
      .select("id, email, name, image, password_hash, email_verified, profile_complete, deleted_at, roles!role_id(name)")
      .ilike("email", emailMatchPattern(email))
      .single();

    // A deleted account fails identically to a wrong password: same status,
    // same message, so the response never confirms the address was registered.
    // Unknown and deleted accounts count as failures too, so lockout cannot be
    // used to tell which emails exist.
    if (!user || !user.password_hash || user.deleted_at) {
      recordLoginFailure(who);
      return Response.json({ error: AUTH_ERRORS.INVALID_CREDENTIALS }, { status: 401 });
    }

    if (!user.email_verified) {
      return Response.json({ error: AUTH_ERRORS.EMAIL_NOT_VERIFIED }, { status: 403 });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      recordLoginFailure(who);
      return Response.json({ error: AUTH_ERRORS.INVALID_CREDENTIALS }, { status: 401 });
    }

    recordLoginSuccess(who);

    const [accessToken, refreshToken] = await Promise.all([
      signAccessToken({
        id: user.id,
        role: user.roles?.name ?? "student",
        profileComplete: user.profile_complete ?? false,
      }),
      signRefreshToken({ id: user.id }),
    ]);

    return Response.json({ accessToken, refreshToken, user: buildUserPayload(user) });
  } catch (err) {
    console.error("mobile/login error:", err);
    return Response.json({ error: AUTH_ERRORS.SERVER_ERROR }, { status: 500 });
  }
}
