import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import supabase from "@/lib/supabase";
import { sanitizeCallbackUrl } from "@/lib/auth/callbackUrl";

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get("token");

  if (!token) {
    redirect("/login?error=invalid_token");
  }

  const now = new Date().toISOString();
  const { data: user } = await supabase
    .from("users")
    .select("id")
    .eq("email_verification_token", token)
    .eq("email_verified", false)
    .gt("email_verification_expires_at", now)
    .single();

  if (!user) {
    redirect("/login?error=invalid_token");
  }

  await supabase
    .from("users")
    .update({
      email_verified: true,
      email_verification_token: null,
      email_verification_expires_at: null,
    })
    .eq("id", user.id);

  // Back to whatever they were doing when they signed up, if the link says so.
  const next = sanitizeCallbackUrl(searchParams.get("next"), null);
  redirect(next ? `/login?verified=1&callbackUrl=${encodeURIComponent(next)}` : "/login?verified=1");
}

/*
 * POST { token }: the same verification for the mobile app, which opens the emailed link
 * itself and cannot follow the redirect above. The token is checked, expired and cleared
 * exactly as in GET; the answer is JSON and there is no redirect.
 */
export async function POST(req) {
  let token = null;
  try {
    ({ token } = await req.json());
  } catch {
    // fall through to the invalid-link answer
  }

  const invalid = () =>
    NextResponse.json({ error: "Verification link is invalid or has expired." }, { status: 400 });

  if (typeof token !== "string" || !token) return invalid();

  const now = new Date().toISOString();
  const { data: user } = await supabase
    .from("users")
    .select("id")
    .eq("email_verification_token", token)
    .eq("email_verified", false)
    .gt("email_verification_expires_at", now)
    .single();

  if (!user) return invalid();

  await supabase
    .from("users")
    .update({
      email_verified: true,
      email_verification_token: null,
      email_verification_expires_at: null,
    })
    .eq("id", user.id);

  return NextResponse.json({ ok: true });
}
