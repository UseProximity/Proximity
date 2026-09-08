/*
 * Flush the batched review confirmation for whoever just finished reviewing.
 *
 * Called by the review flow when the student leaves the loop — "no thanks" to
 * another review, or finishing/skipping the profile step. It is only ever an
 * EARLY send: /api/cron/review-confirmations sweeps the same rows 30 minutes
 * later, so a student who closes the tab still gets their email. Both paths go
 * through flushReviewConfirmation, which claims rows before mailing, so the two
 * racing produces one email rather than two.
 *
 * Auth is deliberately looser than the rest of the review API. The signed-out
 * QR flow has no session — the account it just created cannot be signed into
 * yet — so the profile-setup token stands in as proof of who is asking. That
 * token is already the credential for editing this profile (lib/reviews/
 * onboarding.js), so it grants nothing new here; the worst it can do is send
 * that account's own confirmation to that account's own address, early.
 *
 * @auth public
 */
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import supabase from "@/lib/supabase";
import { getBaseUrl } from "@/lib/email";
import { flushReviewConfirmation } from "@/lib/reviews/confirmation";

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const token = String(body.setupToken || "").trim();

    // A session wins; the setup token is the fallback for an account that has
    // no way to sign in yet. Never trust a user id from the request body.
    let userId = null;
    const session = await auth();
    if (session?.user?.id) {
      userId = session.user.id;
    } else if (token) {
      const { data } = await supabase
        .from("users")
        .select("id, profile_setup_expires_at")
        .eq("profile_setup_token", token)
        .is("deleted_at", null)
        .maybeSingle();
      const live =
        data?.profile_setup_expires_at &&
        new Date(data.profile_setup_expires_at).getTime() > Date.now();
      if (live) userId = data.id;
    }

    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const result = await flushReviewConfirmation({ userId, baseUrl: getBaseUrl(req) });
    // "Nothing pending" is the normal outcome of a double-click, not a failure.
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.error("POST /api/reviews/confirm failed:", e?.message);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
