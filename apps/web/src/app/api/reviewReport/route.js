/*
 * POST /api/reviewReport { reviewId }
 *
 * Reports a review for a person to look at later. Signed-in users only. The
 * reported author is read from the review here, never trusted from the client,
 * so an anonymous review can be reported without its author being revealed.
 * Reporting twice is a harmless no-op (unique per reporter and review).
 */
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import supabase from "@/lib/supabase";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = session.user.id;

    const { reviewId } = await req.json().catch(() => ({}));
    if (typeof reviewId !== "string" || !UUID.test(reviewId)) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const { data: review, error: reviewErr } = await supabase
      .from("listing_reviews")
      .select("id, user_id, deleted_at")
      .eq("id", reviewId)
      .maybeSingle();

    if (reviewErr) {
      console.error("[reviewReport] review lookup failed:", reviewErr.message);
      return NextResponse.json({ error: "Server error" }, { status: 500 });
    }
    if (!review || review.deleted_at) {
      return NextResponse.json({ error: "Review not found" }, { status: 404 });
    }
    if (review.user_id === userId) {
      return NextResponse.json({ error: "You can't report your own review" }, { status: 400 });
    }

    const { error } = await supabase.from("review_reports").insert({
      reporter_id: userId,
      review_id: reviewId,
      reported_user_id: review.user_id ?? null,
    });

    // 23505 = already reported by this user. Treat as success.
    if (error && error.code !== "23505") {
      console.error("[reviewReport] insert failed:", error.message);
      return NextResponse.json({ error: "Server error" }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[reviewReport] unexpected error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
