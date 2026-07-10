import supabase from "@/lib/supabase";
import { signAccessToken, signRefreshToken, buildUserPayload } from "@/lib/authMobile";
import { AUTH_ERRORS } from "@proximity/auth-core";

export async function POST(req) {
  try {
    const { idToken } = await req.json();

    if (!idToken) {
      return Response.json({ error: AUTH_ERRORS.MISSING_FIELDS }, { status: 400 });
    }

    // Verify the Google id_token via tokeninfo endpoint
    const tokenInfoRes = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`
    );
    if (!tokenInfoRes.ok) {
      return Response.json({ error: AUTH_ERRORS.INVALID_TOKEN }, { status: 401 });
    }
    const tokenInfo = await tokenInfoRes.json();
    if (tokenInfo.aud !== process.env.GOOGLE_ID) {
      return Response.json({ error: AUTH_ERRORS.INVALID_TOKEN }, { status: 401 });
    }

    const { email, name, picture } = tokenInfo;

    // Look up user by email
    const { data: existing } = await supabase
      .from("users")
      .select("id, email, name, image, profile_complete, roles!role_id(name)")
      .eq("email", email)
      .single();

    let userRow;

    if (existing) {
      const imageUpdate = picture ? { image: picture, google_account: true } : { google_account: true };
      await supabase.from("users").update(imageUpdate).eq("email", email);
      userRow = {
        ...existing,
        image: picture ?? existing.image,
      };
    } else {
      const { data: studentRole } = await supabase
        .from("roles")
        .select("id")
        .eq("name", "student")
        .single();

      const { data: newUser, error: insertError } = await supabase
        .from("users")
        .insert({
          email,
          name: name || email.split("@")[0] || "New User",
          image: picture ?? null,
          role_id: studentRole?.id,
          profile_complete: false,
          email_verified: true,
          google_account: true,
          gender: "unspecified",
          phone: "N/A",
          description: "",
          referral_source: "",
        })
        .select("id, email, name, image, profile_complete, roles!role_id(name)")
        .single();

      if (insertError) {
        console.error("mobile/google: insert error", insertError);
        return Response.json({ error: AUTH_ERRORS.SERVER_ERROR }, { status: 500 });
      }
      userRow = newUser;
    }

    const [accessToken, refreshToken] = await Promise.all([
      signAccessToken({ id: userRow.id, role: userRow.roles?.name ?? "student" }),
      signRefreshToken({ id: userRow.id }),
    ]);

    return Response.json({ accessToken, refreshToken, user: buildUserPayload(userRow) });
  } catch (err) {
    console.error("mobile/google error:", err);
    return Response.json({ error: AUTH_ERRORS.SERVER_ERROR }, { status: 500 });
  }
}
