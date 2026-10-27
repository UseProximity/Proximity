import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import supabase from "@/lib/supabase";
import { sanitizeCallbackUrl } from "@/lib/auth/callbackUrl";
import { redeemVerificationToken } from "@/lib/auth/verifyEmail";

// @tables users (the queries live in lib/auth/verifyEmail.js)
async function redeem(token) {
  try {
    return await redeemVerificationToken(supabase, token);
  } catch (err) {
    return { status: "error", error: err };
  }
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get("token");

  if (!token) {
    redirect("/login?error=invalid_token");
  }

  const result = await redeem(token);

  if (result.status === "error") {
    console.error("verify-email error:", result.error);
    redirect("/login?error=verification_failed");
  }
  if (result.status !== "ok") {
    redirect("/login?error=invalid_token");
  }

  // Back to whatever they were doing when they signed up, if the link says so.
  const next = sanitizeCallbackUrl(searchParams.get("next"), null);
  redirect(next ? `/login?verified=1&callbackUrl=${encodeURIComponent(next)}` : "/login?verified=1");
}

/*
 * POST { token }: the same verification for the mobile app, which opens the emailed link
 * itself and cannot follow the redirect above. The token is checked, expired and cleared
 * exactly as in GET; the answer is JSON and there is no redirect. 400 means the link is
 * dead, 500 means try again.
 */
export async function POST(req) {
  let token = null;
  try {
    ({ token } = await req.json());
  } catch {
    // fall through to the invalid-link answer
  }

  if (typeof token !== "string" || !token) {
    return NextResponse.json({ error: "Verification link is invalid or has expired." }, { status: 400 });
  }

  const result = await redeem(token);

  if (result.status === "error") {
    console.error("verify-email error:", result.error);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
  if (result.status !== "ok") {
    return NextResponse.json({ error: "Verification link is invalid or has expired." }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
