/*
 * POST /api/userBlock { userId } or { reviewId }
 *
 * Blocks a user for the signed-in caller. The block is a generic user-to-user
 * relationship (user_blocks), not a review feature: reviews read it today,
 * messaging can read it later. It only changes what the blocker sees; nothing
 * is deleted or hidden for anyone else.
 *
 * `reviewId` lets a client block a review's author without ever being told who
 * that is. It is refused for anonymous reviews (and reviews with no account):
 * blocking hides the author's other reviews from the blocker, which would let
 * them work out who wrote an anonymous one. Anonymous reviews can be reported,
 * not blocked.
 *
 * There is no unblock endpoint yet: support removes a block by hand. Blocking
 * someone already blocked is a no-op.
 */
import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/getRequestUser";
import supabase from "@/lib/supabase";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req) {
  try {
    // Web cookie or mobile Bearer token.
    const requestUser = await getRequestUser(req);
    if (!requestUser?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = requestUser.id;

    const body = await req.json().catch(() => ({}));
    let targetId = body.userId;

    if (body.reviewId !== undefined) {
      if (typeof body.reviewId !== "string" || !UUID.test(body.reviewId)) {
        return NextResponse.json({ error: "Invalid request" }, { status: 400 });
      }
      const { data: review, error: reviewErr } = await supabase
        .from("listing_reviews")
        .select("user_id, anonymous")
        .eq("id", body.reviewId)
        .maybeSingle();
      if (reviewErr) {
        console.error("[userBlock] review lookup failed:", reviewErr.message);
        return NextResponse.json({ error: "Server error" }, { status: 500 });
      }
      if (!review) {
        return NextResponse.json({ error: "Review not found" }, { status: 404 });
      }
      if (review.anonymous || !review.user_id) {
        return NextResponse.json(
          { error: "This reviewer can't be blocked" },
          { status: 400 }
        );
      }
      targetId = review.user_id;
    }

    if (typeof targetId !== "string" || !UUID.test(targetId)) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }
    if (targetId === userId) {
      return NextResponse.json({ error: "You can't block yourself" }, { status: 400 });
    }

    const { data: target } = await supabase
      .from("users")
      .select("id")
      .eq("id", targetId)
      .maybeSingle();
    if (!target) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const { error } = await supabase
      .from("user_blocks")
      .upsert(
        { blocker_id: userId, blocked_id: targetId },
        { onConflict: "blocker_id,blocked_id", ignoreDuplicates: true }
      );
    if (error) {
      console.error("[userBlock] insert failed:", error.message);
      return NextResponse.json({ error: "Server error" }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[userBlock] unexpected error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
