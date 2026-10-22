import { NextResponse } from "next/server";
import { auth } from "@/auth";
import supabase from "@/lib/supabase";
import { insertAsUser, updateAsUser, deleteAsUser } from "@/lib/supabaseWithUser";
import { checkReviewText } from "@/lib/contentRules";
import { reviewEditRateLimited } from "@/lib/reviews/rateLimit";

/*
 * POST   /api/replyReview { reviewId, reply }  primary landlord replies to a review
 * PATCH  /api/replyReview { replyId, reply }   author edits their reply
 * DELETE /api/replyReview { replyId }          author deletes their reply
 *
 * PATCH and DELETE are author only: the reply's user_id is read from the row
 * and compared with the session. Edits keep the no-names rule and stamp
 * edited_at for the "Edited" label. Delete is a hard delete so the landlord can
 * reply again later (review_id is unique); action_log keeps a copy.
 *
 * @auth user
 */

export async function POST(req) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      console.log("POST /api/reviewReply failed: Unauthorized");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();

    const { reviewId, reply } = body;

    if (!reviewId || typeof reply !== "string" || !reply.trim()) {
      console.log("POST /api/reviewReply failed: Missing fields", { body });
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    // A public reply naming the student who wrote the review is the same
    // exposure as a review naming the landlord, so it is held to the same rule.
    const named = checkReviewText(reply);
    if (named) {
      return NextResponse.json({ error: named }, { status: 400 });
    }

    const { data: review } = await supabase
      .from("listing_reviews")
      .select("id, listing_id")
      .eq("id", reviewId)
      .single();

    if (!review) {
      console.log("POST /api/reviewReply failed: Review not found");
      return NextResponse.json({ error: "Review not found" }, { status: 404 });
    }

    const { data: landlordLink } = await supabase
      .from("listing_landlords")
      .select("is_primary")
      .eq("listing_id", review.listing_id)
      .eq("user_id", session.user.id)
      .maybeSingle();

    if (!landlordLink?.is_primary) {
      console.log("POST /api/reviewReply failed: User not authorized to reply");
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { data: newReply, error } = await insertAsUser(supabase, {
      userId: session.user.id,
      table: "listing_review_replies",
      data: {
        review_id: reviewId,
        user_id: session.user.id,
        reply: reply.trim(),
      },
    });

    if (error) {
      // review_id is unique: a review gets one reply.
      if (error.code === "23505") {
        return NextResponse.json(
          { error: "This review already has a reply" },
          { status: 409 }
        );
      }

      console.error("POST /api/reviewReply failed:", error);

      return NextResponse.json({ error: "Server error" }, { status: 500 });
    }

    return NextResponse.json(newReply);
  } catch (e) {
    console.error("POST /api/reviewReply failed:", e);

    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/*
 * Shared gate for PATCH and DELETE: signed in, valid id, under the rate limit,
 * and the reply exists and was written by this account. Returns { reply } or
 * { response } to send back as-is.
 */
async function loadOwnReply(replyId) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  if (typeof replyId !== "string" || !UUID.test(replyId)) {
    return { response: NextResponse.json({ error: "Invalid request" }, { status: 400 }) };
  }

  if (reviewEditRateLimited(userId)) {
    return {
      response: NextResponse.json(
        { error: "Too many changes. Please try again later." },
        { status: 429 }
      ),
    };
  }

  const { data: reply, error } = await supabase
    .from("listing_review_replies")
    .select("id, user_id, reply")
    .eq("id", replyId)
    .maybeSingle();

  if (error) {
    console.error("[replyReview] reply lookup failed:", error.message);
    return { response: NextResponse.json({ error: "Server error" }, { status: 500 }) };
  }
  // Someone else's reply gets the same answer as a missing one.
  if (!reply || reply.user_id !== userId) {
    return { response: NextResponse.json({ error: "Reply not found" }, { status: 404 }) };
  }

  return { reply, userId };
}

export async function PATCH(req) {
  try {
    const { replyId, reply: text } = await req.json().catch(() => ({}));
    const { reply, userId, response } = await loadOwnReply(replyId);
    if (response) return response;

    const trimmed = typeof text === "string" ? text.trim() : "";
    if (!trimmed) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    const named = checkReviewText(trimmed);
    if (named) {
      return NextResponse.json({ error: named }, { status: 400 });
    }

    // Saving without a change is not an edit, so it does not earn the label.
    if (trimmed === reply.reply) {
      return NextResponse.json({ ok: true, reply: reply.reply, editedAt: null });
    }

    const { data: updated, error } = await updateAsUser(supabase, {
      userId,
      table: "listing_review_replies",
      rowId: reply.id,
      data: { reply: trimmed, edited_at: new Date().toISOString() },
    });

    if (error || !updated) {
      console.error("PATCH /api/replyReview failed:", error);
      return NextResponse.json({ error: "Server error" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, reply: updated.reply, editedAt: updated.edited_at });
  } catch (e) {
    console.error("PATCH /api/replyReview failed:", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function DELETE(req) {
  try {
    const { replyId } = await req.json().catch(() => ({}));
    const { reply, userId, response } = await loadOwnReply(replyId);
    if (response) return response;

    const { error } = await deleteAsUser(supabase, {
      userId,
      table: "listing_review_replies",
      rowId: reply.id,
    });

    if (error) {
      console.error("DELETE /api/replyReview failed:", error);
      return NextResponse.json({ error: "Server error" }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("DELETE /api/replyReview failed:", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
