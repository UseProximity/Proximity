import { NextResponse } from "next/server";
import { auth } from "@/auth";
import supabase from "@/lib/supabase";
import { insertAsUser, updateAsUser, deleteAsUser } from "@/lib/supabaseWithUser";
import { checkReviewText } from "@/lib/contentRules";
import { reviewEditRateLimited } from "@/lib/reviews/rateLimit";

/*
 * POST   /api/replyReview { reviewId, reply }  a landlord on the listing replies to a review
 * PATCH  /api/replyReview { replyId, reply }   a landlord on the listing edits the reply
 * DELETE /api/replyReview { replyId }          a landlord on the listing deletes the reply
 *
 * The reply speaks for the listing, so every landlord linked to it (primary or
 * co-landlord) can post, edit and delete it, not just whoever wrote it. That way
 * a team keeps control of its replies when the person who wrote one leaves.
 * Edits keep the no-names rule and stamp edited_at for the "Edited" label.
 * Delete is a hard delete so the team can reply again later (review_id is
 * unique); action_log keeps a copy and records who made each change.
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

    if (!(await isListingLandlord(review.listing_id, session.user.id))) {
      console.log("POST /api/reviewReply failed: User not authorized to reply");
      return NextResponse.json(
        { error: "Only landlords on this listing can reply to its reviews." },
        { status: 403 }
      );
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
      // review_id is unique: a review gets one reply. When a teammate got
      // there first, send theirs back so the card can show it.
      if (error.code === "23505") {
        const { data: existing } = await supabase
          .from("listing_review_replies")
          .select("id, reply, created_at, updated_at, edited_at, user_id")
          .eq("review_id", reviewId)
          .maybeSingle();
        return NextResponse.json(
          { error: "A reply to this review was already posted.", reply: existing ?? null },
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

// Any landlord linked to the listing, primary or not. Billing-only accounts
// hold no listing links, so they never pass.
async function isListingLandlord(listingId, userId) {
  const { data } = await supabase
    .from("listing_landlords")
    .select("user_id")
    .eq("listing_id", listingId)
    .eq("user_id", userId)
    .maybeSingle();
  return Boolean(data);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/*
 * Shared gate for PATCH and DELETE: signed in, valid id, under the rate limit,
 * and the reply exists on a listing this account is a landlord of. Returns
 * { reply } or { response } to send back as-is.
 */
async function loadTeamReply(replyId) {
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
    .select("id, user_id, reply, review:listing_reviews!review_id(listing_id)")
    .eq("id", replyId)
    .maybeSingle();

  if (error) {
    console.error("[replyReview] reply lookup failed:", error.message);
    return { response: NextResponse.json({ error: "Server error" }, { status: 500 }) };
  }
  // A reply on someone else's listing gets the same answer as a missing one.
  // Access follows the listing, so an author removed from it loses it too.
  const allowed =
    reply?.review?.listing_id &&
    (await isListingLandlord(reply.review.listing_id, userId));
  if (!allowed) {
    return { response: NextResponse.json({ error: "Reply not found" }, { status: 404 }) };
  }

  return { reply, userId };
}

export async function PATCH(req) {
  try {
    const { replyId, reply: text } = await req.json().catch(() => ({}));
    const { reply, userId, response } = await loadTeamReply(replyId);
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
    const { reply, userId, response } = await loadTeamReply(replyId);
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
