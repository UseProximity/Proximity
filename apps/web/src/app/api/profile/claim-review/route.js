/*
 * Reconcile a QR review with the Google account the student actually signed in
 * with.
 *
 * @auth any
 *
 * The review flow creates an account from the email typed into the form. When
 * the student then finishes by signing in with Google, the address Google hands
 * back is often a different one (a personal gmail, or their other school
 * alias). Two accounts now exist for one person, and the review is on the wrong
 * one.
 *
 * Authorization is deliberately BOTH: a live session (proving they control the
 * Google account) AND the profile-setup token (proving this browser is the one
 * that just posted the review). Either alone would let someone sweep up reviews
 * that are not theirs.
 *
 * GET  → describe the mismatch so the page can ask which email to keep.
 * POST → move the reviews onto the signed-in account and discard the placeholder.
 *
 * Moving happens BEFORE the delete, and the order matters: listing_reviews.user_id
 * and dorm_reviews.user_id are ON DELETE SET NULL, so deleting first would
 * silently orphan the review from its author rather than fail.
 */
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import supabase from "@/lib/supabase";
import { loadProfileSetupUser, clearProfileSetupToken } from "@/lib/reviews/onboarding";

export const dynamic = "force-dynamic";

async function countReviews(userId) {
  const [{ count: listings }, { count: dorms }] = await Promise.all([
    supabase
      .from("listing_reviews")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .is("deleted_at", null),
    supabase
      .from("dorm_reviews")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .is("deleted_at", null),
  ]);
  return (listings ?? 0) + (dorms ?? 0);
}

export async function GET(req) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const token = new URL(req.url).searchParams.get("token");
    const found = await loadProfileSetupUser(token);
    if (!found) {
      return NextResponse.json({ error: "This link is no longer valid." }, { status: 404 });
    }

    // Same row: Google matched the typed address, so auth.js signed them into
    // the very account the review is on. Nothing to reconcile.
    const sameAccount = found.userId === session.user.id;

    return NextResponse.json({
      sameAccount,
      reviewEmail: found.email,
      sessionEmail: session.user.email || "",
      reviewCount: sameAccount ? 0 : await countReviews(found.userId),
    });
  } catch (e) {
    console.error("GET /api/profile/claim-review failed:", e?.message);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { token } = await req.json();
    const found = await loadProfileSetupUser(token);
    if (!found) {
      return NextResponse.json({ error: "This link is no longer valid." }, { status: 404 });
    }

    const placeholderId = found.userId;
    const targetId = session.user.id;
    if (placeholderId === targetId) {
      return NextResponse.json({ ok: true, moved: 0, sameAccount: true });
    }

    /*
     * Only ever discard an account that is still the empty shell this flow
     * created: no way to sign in, no finished profile, not a system account.
     * Anything else is somebody's real account and is left completely alone.
     */
    const { data: placeholder } = await supabase
      .from("users")
      .select("id, email, school_id, graduation_year, graduation_month, password_hash, google_account, apple_account, profile_complete, is_system")
      .eq("id", placeholderId)
      .maybeSingle();

    if (
      !placeholder ||
      placeholder.is_system ||
      placeholder.profile_complete ||
      placeholder.password_hash ||
      placeholder.google_account ||
      placeholder.apple_account
    ) {
      return NextResponse.json(
        { error: "That account can't be merged automatically." },
        { status: 409 }
      );
    }

    // ── Move the reviews first ──────────────────────────────────────────────
    let moved = 0;
    for (const table of ["listing_reviews", "dorm_reviews"]) {
      const { data, error } = await supabase
        .from(table)
        .update({ user_id: targetId })
        .eq("user_id", placeholderId)
        .select("id");
      if (error) {
        console.error(`claim-review: moving ${table} failed:`, error.message);
        return NextResponse.json({ error: "Couldn't move your review." }, { status: 500 });
      }
      moved += data?.length ?? 0;
    }

    // Carry over what the review flow learned and the real account lacks. Never
    // overwrite: the signed-in account's own values are the authority.
    const { data: target } = await supabase
      .from("users")
      .select("school_id, graduation_year, graduation_month")
      .eq("id", targetId)
      .maybeSingle();
    const carry = {};
    if (!target?.school_id && placeholder.school_id) carry.school_id = placeholder.school_id;
    if (!target?.graduation_year && placeholder.graduation_year) {
      carry.graduation_year = placeholder.graduation_year;
      carry.graduation_month = placeholder.graduation_month;
    }
    if (Object.keys(carry).length) {
      const { error } = await supabase.from("users").update(carry).eq("id", targetId);
      if (error) console.error("claim-review: carry-over failed:", error.message);
    }

    // ── Discard the now-empty placeholder ───────────────────────────────────
    await clearProfileSetupToken(placeholderId);
    const { error: delErr } = await supabase.from("users").delete().eq("id", placeholderId);
    if (delErr) {
      // The reviews are already safely on the real account, so this is untidy
      // rather than broken: leave the shell behind and say nothing to the user.
      console.error("claim-review: placeholder delete failed:", delErr.message);
    }

    return NextResponse.json({ ok: true, moved, sameAccount: false });
  } catch (e) {
    console.error("POST /api/profile/claim-review failed:", e?.message);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
