/*
 * Give a QR-review account a password, so the student can actually sign in later.
 *
 * @auth public
 *
 * Authorized by the profile-setup token, exactly like complete-from-review: the
 * token only ever exists for an account with no password, no Google and no
 * Apple login, so this can never overwrite a real user's credentials.
 *
 * EMAIL VERIFICATION IS NOT GRANTED HERE, and that is the point. Filling in a
 * form proves nothing about owning the inbox, so a password set inline leaves
 * email_verified false and the Credentials provider keeps refusing the login
 * (auth.js throws EMAIL_NOT_VERIFIED) until they open the emailed link. That is
 * the same bargain /api/auth/signup makes, and without it anyone could type a
 * stranger's address into a review and set a password on it.
 *
 * Opening the emailed link (/review/finish) verifies the address, so a student
 * who lands here from their inbox can set a password and sign in immediately.
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
