import { NextResponse } from "next/server";
import supabase from "@/libs/supabase";
import { getBaseUrl, sendPasswordResetEmail } from "@/libs/verificationEmail";

export async function POST(req) {
  try {
    const { email } = await req.json();

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "Valid email is required." }, { status: 400 });
    }

    const { data: user } = await supabase
      .from("users")
      .select("id, name, google_account")
      .eq("email", email)
      .single();

    if (!user) {
      return NextResponse.json({ error: "No account found for that email." }, { status: 404 });
    }
    if (user.google_account) {
      return NextResponse.json({ error: "This email is linked to a Google account. Please sign in with Google." }, { status: 404 });
    }

    const token = crypto.randomUUID();
    const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    await supabase
      .from("users")
      .update({ password_reset_token: token, password_reset_expires_at: expires })
      .eq("id", user.id);

    await sendPasswordResetEmail({
      email,
      name: user.name,
      token,
      baseUrl: getBaseUrl(req),
    });

    return NextResponse.json({}, { status: 200 });
  } catch (err) {
    console.error("forgot-password error:", err);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
