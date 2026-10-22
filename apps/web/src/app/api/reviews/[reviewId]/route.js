/*
 * PATCH  /api/reviews/:reviewId { comment, rating }  edit your own review
 * DELETE /api/reviews/:reviewId                      delete your own review
 *
 * Author only. The owner is read from the review row and compared with the
 * session, never taken from the request, so one account cannot touch another
 * account's review. Edits are held to the same rules as a new review (half-star
 * overall rating, 5+ characters, no names) and stamp edited_at, which the card
 * shows as "Edited". Only the overall rating is editable; the category ratings
 * stay as first submitted.
 *
 * Delete is a soft delete (deleted_at), like every other review removal, so the
 * review and its stars drop out of the listing while action_log keeps a copy.
 * Both verbs share a per-account rate limit (lib/reviews/rateLimit.js).
 *
 * @auth user
 */
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import supabase from "@/lib/supabase";
import { updateAsUser } from "@/lib/supabaseWithUser";
import { checkReviewText } from "@/lib/contentRules";
import { reviewEditRateLimited } from "@/lib/reviews/rateLimit";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isHalfStar(v) {
  return typeof v === "number" && v >= 0.5 && v <= 5 && Number.isInteger(v * 2);
}

/*
 * Shared gate for both verbs: signed in, valid id, under the rate limit, and
 * the review exists and belongs to this account. Returns { review } or
 * { response } to send back as-is.
 */
async function loadOwnReview(params) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const { reviewId } = await params;
  if (typeof reviewId !== "string" || !UUID.test(reviewId)) {
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

  const { data: review, error } = await supabase
    .from("listing_reviews")
    .select("id, user_id, comment, rating, deleted_at")
    .eq("id", reviewId)
    .maybeSingle();

  if (error) {
    console.error("[reviews/:id] review lookup failed:", error.message);
    return { response: NextResponse.json({ error: "Server error" }, { status: 500 }) };
  }
  if (!review || review.deleted_at) {
    return { response: NextResponse.json({ error: "Review not found" }, { status: 404 }) };
  }
  // Same answer as not found: nobody learns which ids are real reviews.
  if (review.user_id !== userId) {
    return { response: NextResponse.json({ error: "Review not found" }, { status: 404 }) };
  }

  return { review, userId };
}

export async function PATCH(req, { params }) {
  try {
    const { review, userId, response } = await loadOwnReview(params);
    if (response) return response;

    const { comment, rating } = await req.json().catch(() => ({}));
    const text = typeof comment === "string" ? comment.trim() : "";

    if (!isHalfStar(rating) || text.length < 5) {
      return NextResponse.json({ error: "Invalid rating or comment" }, { status: 400 });
    }

    const named = checkReviewText(text);
    if (named) {
      return NextResponse.json({ error: named }, { status: 400 });
    }

    // Saving without a change is not an edit, so it does not earn the label.
    if (text === review.comment && Number(rating) === Number(review.rating)) {
      return NextResponse.json({ ok: true, comment: review.comment, rating: review.rating, editedAt: null });
    }

    const { data: updated, error } = await updateAsUser(supabase, {
      userId,
      table: "listing_reviews",
      rowId: review.id,
      data: { comment: text, rating, edited_at: new Date().toISOString() },
    });

    if (error || !updated) {
      console.error("[reviews/:id] PATCH failed:", error);
      return NextResponse.json({ error: "Server error" }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      comment: updated.comment,
      rating: updated.rating,
      editedAt: updated.edited_at,
    });
  } catch (e) {
    console.error("[reviews/:id] PATCH unexpected error:", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function DELETE(req, { params }) {
  try {
    const { review, userId, response } = await loadOwnReview(params);
    if (response) return response;

    const { error } = await updateAsUser(supabase, {
      userId,
      table: "listing_reviews",
      rowId: review.id,
      data: { deleted_at: new Date().toISOString() },
    });

    if (error) {
      console.error("[reviews/:id] DELETE failed:", error);
      return NextResponse.json({ error: "Server error" }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[reviews/:id] DELETE unexpected error:", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
