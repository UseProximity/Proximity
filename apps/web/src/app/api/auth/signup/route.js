import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import supabase from "@/lib/supabase";
import { hashToken } from "@/lib/auth/tokenHash";
import {
  getBaseUrl,
  sendVerificationEmail,
  sendPasswordResetEmail,
} from "@/lib/email";
import { sanitizeCallbackUrl } from "@/lib/auth/callbackUrl";
import { emailMatchPattern, normalizeEmail } from "@/lib/auth/email";
import { SIGNUP_ROLES } from "@/lib/auth/roles";
import { isRestorable } from "@/lib/auth/accountRestore";

export async function POST(req) {
  try {
    const { name, email: rawEmail, password, role, callbackUrl } = await req.json();
    const email = normalizeEmail(rawEmail);

    if (!name?.trim())
      return NextResponse.json({ error: "Name is required." }, { status: 400 });
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json(
        { error: "Valid email is required." },
        { status: 400 }
      );
    }
    if (!password || password.length < 8) {
      return NextResponse.json(
        { error: "Password must be at least 8 characters." },
        { status: 400 }
      );
    }

    // Honor the role chosen on the signup form; default to student. This lets an
    // email/password landlord be created with the right role from the start so
    // their first session token is correct (mirrors Google's "Login as Landlord").
    const signupRole = SIGNUP_ROLES.has(role) ? role : "student";

    const { data: existing } = await supabase
      .from("users")
      .select("id, name, password_hash, deleted_at, google_account, apple_account")
      .ilike("email", emailMatchPattern(email))
      .single();

    if (existing) {
      // Deleted accounts keep their row (and email) for a 30-day grace period
      // before the purge cron frees it up (api/cron/purge-accounts). Inside it,
      // signing in offers to restore the account (lib/auth/accountRestore), so
      // point there rather than at a new account.
      if (existing.deleted_at) {
        return NextResponse.json(
          {
            error: isRestorable(existing)
              ? "This email belongs to an account that was deleted recently. Sign in with it to restore the account, or wait 30 days from deletion to sign up fresh. Need help? Contact info@useproximity.org."
              : "This email frees up shortly, once its deleted account finishes being removed. Try again tomorrow. Need help? Contact info@useproximity.org.",
          },
          { status: 409 }
        );
      }
      /*
       * google_account is what makes an account a Google one, NOT the absence
       * of a password. This used to branch on `!password_hash` and told every
       * credential-less row to "sign in with Google", which is wrong for the
       * largest group of them: landlords whose rows the listing importer
       * created. They have no password AND no Google identity, so the Google
       * button cannot help them, and many of those addresses are not Google
       * accounts at all. They were left with no way in.
       */
      if (existing.google_account) {
        return NextResponse.json(
          {
            error:
              "This email uses Google sign-in. Please continue with Google.",
          },
          { status: 409 }
        );
      }

      // A Sign in with Apple account (created by the mobile app) has no password
      // either, but it is not an unclaimed row: do not offer the set-password claim.
      if (existing.apple_account) {
        return NextResponse.json(
          {
            error: "This email is linked to an Apple account. Please sign in with Apple.",
          },
          { status: 409 }
        );
      }

      /*
       * A row with neither a password nor Google is claimable: the person it
       * describes has never signed in. Rather than refuse, email them a
       * set-password link, which is the same flow and the same token as a
       * reset. Receiving it is what proves they control the address.
       *
       * Deliberately NOT creating a session or setting the password from this
       * request: anyone can post an email here, and doing either would let a
       * stranger take over a landlord's account by guessing their address.
       */
      if (!existing.password_hash) {
        const token = crypto.randomUUID();
        const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString();

        await supabase
          .from("users")
          .update({
            password_reset_token: hashToken(token),
            password_reset_expires_at: expires,
          })
          .eq("id", existing.id);

        await sendPasswordResetEmail({
          email,
          name: existing.name,
          token,
          baseUrl: getBaseUrl(req),
        });

        return NextResponse.json(
          {
            error:
              "This email is already on Proximity but has no password yet. We have emailed you a link to set one.",
            code: "SET_PASSWORD_EMAILED",
          },
          { status: 409 }
        );
      }

      return NextResponse.json(
        { error: "An account with this email already exists." },
        { status: 409 }
      );
    }

    const password_hash = await bcrypt.hash(password, 12);

    const { data: roleRow } = await supabase
      .from("roles")
      .select("id")
      .eq("name", signupRole)
      .single();

    const { data: newUser, error: insertError } = await supabase
      .from("users")
      .insert({
        email,
        name: name.trim(),
        password_hash,
        role_id: roleRow?.id,
        email_verified: false,
        profile_complete: false,
        gender: "unspecified",
        phone: "N/A",
        description: "",
        referral_source: "",
      })
      .select("id")
      .single();

    if (insertError) {
      console.error("signup: insert error", insertError);
      return NextResponse.json(
        { error: "Failed to create account." },
        { status: 500 }
      );
    }

    const token = crypto.randomUUID();
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    await supabase
      .from("users")
      .update({
        email_verification_token: token,
        email_verification_expires_at: expires,
      })
      .eq("id", newUser.id);

    await sendVerificationEmail({
      email,
      name: name.trim(),
      token,
      baseUrl: getBaseUrl(),
      next: sanitizeCallbackUrl(callbackUrl, null),
      req,
    });

    return NextResponse.json({ email });
  } catch (err) {
    console.error("signup error:", err);
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }
}
