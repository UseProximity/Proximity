import bcrypt from "bcryptjs";
import supabase from "@/lib/supabase";
import { signAccessToken, signRefreshToken, buildUserPayload } from "@/lib/authMobile";
import { AUTH_ERRORS } from "@proximity/auth-core";

export async function POST(req) {
  try {
    const { email, password } = await req.json();

    if (!email || !password) {
      return Response.json({ error: AUTH_ERRORS.MISSING_FIELDS }, { status: 400 });
    }

    const { data: user } = await supabase
      .from("users")
      .select("id, email, name, image, password_hash, email_verified, profile_complete, roles!role_id(name)")
      .eq("email", email)
      .single();

    if (!user || !user.password_hash) {
      return Response.json({ error: AUTH_ERRORS.INVALID_CREDENTIALS }, { status: 401 });
    }

    if (!user.email_verified) {
      return Response.json({ error: AUTH_ERRORS.EMAIL_NOT_VERIFIED }, { status: 403 });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return Response.json({ error: AUTH_ERRORS.INVALID_CREDENTIALS }, { status: 401 });
    }

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
