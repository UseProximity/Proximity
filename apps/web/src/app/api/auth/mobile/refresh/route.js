import supabase from "@/lib/supabase";
import { verifyMobileToken, signAccessToken } from "@/lib/authMobile";
import { AUTH_ERRORS } from "@proximity/auth-core";

export async function POST(req) {
  try {
    const { refreshToken } = await req.json();

    if (!refreshToken) {
      return Response.json({ error: AUTH_ERRORS.MISSING_FIELDS }, { status: 400 });
    }

    let payload;
    try {
      payload = await verifyMobileToken(refreshToken);
    } catch {
      return Response.json({ error: AUTH_ERRORS.INVALID_TOKEN }, { status: 401 });
    }

    if (payload.type !== "refresh") {
      return Response.json({ error: AUTH_ERRORS.INVALID_TOKEN }, { status: 401 });
    }

    const { data: user } = await supabase
      .from("users")
      .select("id, email, name, image, profile_complete, deleted_at, roles!role_id(name)")
      .eq("id", payload.sub)
      .single();

    // Refresh tokens live 30 days and are non-revocable by design, so this is
    // the only chokepoint that can retire one: a deleted account stops getting
    // new access tokens here.
    if (!user || user.deleted_at) {
      return Response.json({ error: AUTH_ERRORS.INVALID_TOKEN }, { status: 401 });
    }

    const accessToken = await signAccessToken({
      id: user.id,
      role: user.roles?.name ?? "student",
      profileComplete: user.profile_complete ?? false,
    });

    return Response.json({ accessToken });
  } catch (err) {
    console.error("mobile/refresh error:", err);
    return Response.json({ error: AUTH_ERRORS.SERVER_ERROR }, { status: 500 });
  }
}
