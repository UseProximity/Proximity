import { NextResponse } from "next/server";
import supabase from "@/libs/supabase";
import { getBaseUrl, sendVerificationEmail } from "@/libs/verificationEmail";

export async function POST(req) {
  try {
    const { email } = await req.json();

    if (!email) return NextResponse.json({ error: "Email is required." }, { status: 400 });

    const { data: user } = await supabase
      .from("users")
      .select("id, name, email_verified, password_hash")
      .eq("email", email)
      .single();

    // Always return 200 to avoid leaking whether an account exists
    if (!user || user.email_verified || !user.password_hash) {
      return NextResponse.json({ ok: true });
    }

    const token = crypto.randomUUID();
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    await supabase
      .from("users")
      .update({ email_verification_token: token, email_verification_expires_at: expires })
      .eq("id", user.id);

    await sendVerificationEmail({ email, name: user.name, token, baseUrl: getBaseUrl(req) });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("resend-verification error:", err);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
