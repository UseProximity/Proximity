import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import supabase from "@/lib/supabase";

export async function POST(req) {
  try {
    const { token, password } = await req.json();

    if (!token || !password || password.length < 8) {
      return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    }

    const now = new Date().toISOString();
    const { data: user } = await supabase
      .from("users")
      .select("id")
      .eq("password_reset_token", token)
      .gt("password_reset_expires_at", now)
      .single();

    if (!user) {
      return NextResponse.json({ error: "Reset link is invalid or has expired." }, { status: 400 });
    }

    const password_hash = await bcrypt.hash(password, 12);

    /*
     * Setting email_verified here is the point, not a side effect. The token
     * was emailed to this address and nothing else can produce it, so using it
     * proves control of the inbox, which is all verification ever meant.
     *
     * Without this, an account that had no password (a landlord row created by
     * the listing importer, or one provisioned from a listing contact address)
     * could set a password through this flow and still be refused at sign-in,
     * because auth.js throws EmailNotVerified on an unverified credentials
     * login. They would be stuck in a loop with no way out.
     */
    await supabase
      .from("users")
      .update({
        password_hash,
        email_verified: true,
        password_reset_token: null,
        password_reset_expires_at: null,
      })
      .eq("id", user.id);

    return NextResponse.json({}, { status: 200 });
  } catch (err) {
    console.error("reset-password error:", err);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
