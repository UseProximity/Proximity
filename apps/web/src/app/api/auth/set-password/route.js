/*
 * POST /api/auth/set-password
 *
 * Sets a first password for the signed-in account. This exists for people who
 * arrived through a chat magic link: landlords whose rows the listing importer
 * created, or who were provisioned from a listing's contact address. They have a
 * real session and can read their messages, but cannot send one until they have
 * credentials of their own (see assertSenderCanSend).
 *
 * Deliberately refuses when a password already exists. Changing a known password
 * is a different operation with a different threat model, and it belongs behind
 * either the old password or an emailed reset token, not behind a session that
 * may have come from a link in an inbox.
 *
 * email_verified is set for the same reason reset-password sets it: every route
 * into this state required receiving mail at the address on the account.
 *
 * @auth session
 */
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { auth } from "@/auth";
import supabase from "@/lib/supabase";

export async function POST(req) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let payload;
    try {
      payload = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const password = typeof payload?.password === "string" ? payload.password : "";
    if (password.length < 8) {
      return NextResponse.json(
        { error: "Password must be at least 8 characters." },
        { status: 400 }
      );
    }

    const { data: user, error: readError } = await supabase
      .from("users")
      .select("id, password_hash, google_account")
      .eq("id", session.user.id)
      .maybeSingle();

    if (readError || !user) {
      console.error("set-password: user read failed", readError);
      return NextResponse.json({ error: "Server error" }, { status: 500 });
    }

    if (user.password_hash) {
      return NextResponse.json(
        {
          error:
            "This account already has a password. Use Forgot password to change it.",
        },
        { status: 409 }
      );
    }

    const password_hash = await bcrypt.hash(password, 12);

    const { error: writeError } = await supabase
      .from("users")
      .update({
        password_hash,
        email_verified: true,
        password_reset_token: null,
        password_reset_expires_at: null,
      })
      .eq("id", user.id);

    if (writeError) {
      console.error("set-password: update failed", writeError);
      return NextResponse.json({ error: "Server error" }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("POST /api/auth/set-password failed:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
