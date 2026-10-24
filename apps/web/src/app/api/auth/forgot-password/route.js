import { NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { sendPasswordReset } from "@/lib/auth/passwordReset";
import { emailMatchPattern, normalizeEmail } from "@/lib/auth/email";

export async function POST(req) {
  try {
    const { email: rawEmail } = await req.json();
    const email = normalizeEmail(rawEmail);

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "Valid email is required." }, { status: 400 });
    }

    const { data: user } = await supabase
      .from("users")
      .select("id, name, google_account, apple_account, password_hash")
      .ilike("email", emailMatchPattern(email))
      .single();

    // Google-only and Apple-only accounts have no password to reset (an
    // email/password account that also linked Apple still has one). They get the
    // same generic response as an unknown address, so nothing here reveals
    // whether the account exists or how it signs in.
    const hasPassword = user && !user.google_account && !(user.apple_account && !user.password_hash);

    if (hasPassword) {
      await sendPasswordReset({ userId: user.id, email, name: user.name, req });
    }

    return NextResponse.json(
      { message: "If an account exists for that email, a reset link has been sent." },
      { status: 200 }
    );
  } catch (err) {
    console.error("forgot-password error:", err);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
