/*
 * Give a QR-review account a password, so the student can actually sign in later.
 *
 * @auth public
 *
 * Authorized by a profile-setup token, and refused for an account that already
 * has a password, Google or Apple login, so this can never overwrite a real
 * user's credentials.
 *
 * ONLY ONCE THE INBOX IS PROVEN: the emailed link token, or an address already
 * verified (an invite). The inline token was handed to whoever typed the
 * address, so a password it set would be a stranger's, sitting on the account
 * and starting to work the moment the real owner verified the address by any
 * route. An inline holder signs in with Google instead, or uses the link.
 */
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import supabase from "@/lib/supabase";
import { loadProfileSetupUser } from "@/lib/reviews/onboarding";

export const dynamic = "force-dynamic";

const MIN_PASSWORD_LENGTH = 8;

export async function POST(req) {
  try {
    const { token, password } = await req.json();

    const found = await loadProfileSetupUser(token);
    if (!found) {
      return NextResponse.json({ error: "This link is no longer valid." }, { status: 404 });
    }
    if (!found.viaEmailLink && !found.emailVerified) {
      return NextResponse.json(
        {
          error: "Open the link we emailed you to set a password.",
          code: "VERIFY_INBOX_FIRST",
        },
        { status: 403 }
      );
    }
    if (found.hasCredentials) {
      return NextResponse.json(
        { error: "This account can already be signed into." },
        { status: 409 }
      );
    }
    if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
      return NextResponse.json(
        { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` },
        { status: 400 }
      );
    }

    const password_hash = await bcrypt.hash(password, 12);
    const { error } = await supabase
      .from("users")
      .update({ password_hash })
      .eq("id", found.userId);

    if (error) {
      console.error("set-review-password: update failed:", error.message);
      return NextResponse.json({ error: "Couldn't save your password." }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      email: found.email,
      // The client tells them to check their inbox when this is false.
      emailVerified: found.emailVerified,
    });
  } catch (e) {
    console.error("POST /api/profile/set-review-password failed:", e?.message);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
