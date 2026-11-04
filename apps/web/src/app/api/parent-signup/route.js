/*
 * /parent-signup intake: a parent leaves an email (and optionally a first name),
 * we save them as a `parent` user and email them the WashU parent guide.
 *
 * The account is a shell, the same shape the waitlist and signed-out review flows
 * create: a users row with no password, unverified, profile incomplete. It exists
 * so parents are a list we can count and reach, not so they can sign in.
 *
 * An address that already has an account keeps its role (Wyatt, 2026-10-30): a
 * student typing their own email must not be quietly turned into a parent. They
 * still get the guide, and the response is the same either way so the form never
 * tells a stranger whether an address is on Proximity.
 *
 * Rate limiting is in-memory per server instance, like /api/feedback: a soft guard
 * against one client using the form to mail strangers, not a guarantee.
 *
 * @auth public
 */
import { NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { sendParentGuideEmail, getBaseUrl } from "@/lib/email";

export const dynamic = "force-dynamic";

const MAX_FIELD = 200;
const EMAIL_RE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const _hits = new Map(); // ip -> number[] (timestamps)

function rateLimited(key) {
  const now = Date.now();
  const recent = (_hits.get(key) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (recent.length >= RATE_LIMIT) {
    _hits.set(key, recent);
    return true;
  }
  recent.push(now);
  _hits.set(key, recent);
  return false;
}

function trim(value) {
  return String(value ?? "").trim().slice(0, MAX_FIELD);
}

export async function POST(req) {
  try {
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      "unknown";

    const body = await req.json().catch(() => ({}));
    const email = trim(body.email).toLowerCase();
    const firstName = trim(body.firstName).slice(0, 60);

    // Honeypot: a hidden field people never see. Bots that fill it get a normal
    // success response and nothing else happens.
    if (trim(body.website)) {
      return NextResponse.json({ ok: true });
    }

    if (!EMAIL_RE.test(email)) {
      return NextResponse.json(
        { error: "Please enter a valid email address." },
        { status: 400 }
      );
    }

    if (rateLimited(ip)) {
      return NextResponse.json(
        { error: "Too many requests. Please try again in a little while." },
        { status: 429 }
      );
    }

    // Deleted rows count as existing: email is unique, so re-inserting would fail.
    const { data: existing, error: lookupError } = await supabase
      .from("users")
      .select("id")
      .eq("email", email)
      .maybeSingle();

    if (lookupError) {
      console.error("[parent-signup] user lookup failed:", lookupError.message);
      return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
    }

    if (!existing) {
      const { data: parentRole } = await supabase
        .from("roles")
        .select("id")
        .eq("name", "parent")
        .maybeSingle();

      // Column defaults mirror /api/auth/signup so every path produces the same shape.
      const { error: insertError } = await supabase.from("users").insert({
        email,
        name: firstName || email.split("@")[0],
        role_id: parentRole?.id ?? null,
        email_verified: false,
        profile_complete: false,
        gender: "unspecified",
        phone: "N/A",
        description: "",
        referral_source: "Parent guide",
      });

      // A concurrent double submit loses the unique-email race. The row exists
      // either way, so that one is not an error.
      if (insertError && insertError.code !== "23505") {
        console.error("[parent-signup] insert failed:", insertError.message);
        return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
      }
    }

    try {
      await sendParentGuideEmail({ email, firstName, baseUrl: getBaseUrl(), req });
    } catch (err) {
      console.error("[parent-signup] guide email failed:", err?.message);
      return NextResponse.json(
        { error: "We saved your email but could not send the guide. Please try again." },
        { status: 502 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[parent-signup] unexpected error:", err);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
