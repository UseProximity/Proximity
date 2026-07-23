import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import supabase from "@/lib/supabase";
import { getBaseUrl, sendVerificationEmail } from "@/lib/email";
import { validateName, validateEmail, validatePassword, SIGNUP_ROLES } from "@proximity/auth-core";

export async function POST(req) {
  try {
    let body;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }
    const { name, email, password, role } = body;

    const nameErr = validateName(name);
    if (nameErr) return NextResponse.json({ error: nameErr }, { status: 400 });
    const emailErr = validateEmail(email);
    if (emailErr) return NextResponse.json({ error: emailErr }, { status: 400 });
    const passwordErr = validatePassword(password);
    if (passwordErr) return NextResponse.json({ error: passwordErr }, { status: 400 });

    // Honor the role chosen on the signup form; default to student. This lets an
    // email/password landlord be created with the right role from the start so
    // their first session token is correct (mirrors Google's "Login as Landlord").
    const signupRole = SIGNUP_ROLES.has(role) ? role : "student";

    const { data: existing } = await supabase
      .from("users")
      .select("id, password_hash")
      .eq("email", email)
      .single();

    if (existing) {
      if (!existing.password_hash) {
        return NextResponse.json(
          { error: "This email is linked to a Google account. Please sign in with Google." },
          { status: 409 }
        );
      }
      return NextResponse.json({ error: "An account with this email already exists." }, { status: 409 });
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
      return NextResponse.json({ error: "Failed to create account." }, { status: 500 });
    }

    const token = crypto.randomUUID();
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    await supabase
      .from("users")
      .update({ email_verification_token: token, email_verification_expires_at: expires })
      .eq("id", newUser.id);

    await sendVerificationEmail({ email, name: name.trim(), token, baseUrl: getBaseUrl(req) });

    return NextResponse.json({ email });
  } catch (err) {
    console.error("signup error:", err);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
