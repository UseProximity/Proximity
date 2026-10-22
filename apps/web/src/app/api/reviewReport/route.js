/*
 * POST /api/reviewReport { reviewId } or { replyId }
 *
 * Reports a review, or a landlord's reply to one, for a person to look at
 * later. Signed-in users only. The reported author is read from the row here,
 * never trusted from the client, so an anonymous review can be reported without
 * its author being revealed. Reporting twice is a harmless no-op (unique per
 * reporter and review, or reporter and reply).
 *
 * Each new report emails the team (sendContentReportEmail). A repeat report
 * sends nothing, and a failed email never fails the report.
 */
import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/getRequestUser";
import supabase from "@/lib/supabase";
import { getBaseUrl, sendContentReportEmail } from "@/lib/email";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req) {
  try {
    // Web cookie or mobile Bearer token.
    const requestUser = await getRequestUser(req);
    if (!requestUser?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = requestUser.id;

    const { reviewId, replyId } = await req.json().catch(() => ({}));
    if (replyId !== undefined) return reportReply(req, userId, replyId);

    if (typeof reviewId !== "string" || !UUID.test(reviewId)) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const { data: review, error: reviewErr } = await supabase
      .from("listing_reviews")
      .select("id, user_id, deleted_at, comment, listing_id, name")
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

    if (!error) {
      await notifyTeam(req, {
        kind: "review",
        text: review.comment,
        authorId: review.user_id,
        authorFallback: review.name,
        reporterId: userId,
        listingId: review.listing_id,
      });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[reviewReport] unexpected error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

async function reportReply(req, userId, replyId) {
  if (typeof replyId !== "string" || !UUID.test(replyId)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const { data: reply, error: replyErr } = await supabase
    .from("listing_review_replies")
    .select("id, user_id, reply, review:listing_reviews!review_id(listing_id)")
    .eq("id", replyId)
    .maybeSingle();

  if (replyErr) {
    console.error("[reviewReport] reply lookup failed:", replyErr.message);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
  if (!reply) {
    return NextResponse.json({ error: "Reply not found" }, { status: 404 });
  }
  if (reply.user_id === userId) {
    return NextResponse.json({ error: "You can't report your own reply" }, { status: 400 });
  }

  const { error } = await supabase.from("review_reply_reports").insert({
    reporter_id: userId,
    reply_id: replyId,
    reported_user_id: reply.user_id ?? null,
  });

  // 23505 = already reported by this user. Treat as success.
  if (error && error.code !== "23505") {
    console.error("[reviewReport] reply insert failed:", error.message);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }

  if (!error) {
    await notifyTeam(req, {
      kind: "landlord reply",
      text: reply.reply,
      authorId: reply.user_id,
      reporterId: userId,
      listingId: reply.review?.listing_id,
    });
  }

  return NextResponse.json({ ok: true });
}

// "Name <email>" for the email. Anonymous reviews show their author here: this
// goes only to the team inbox, which needs to know who to follow up with.
function describeUser(user, fallback) {
  if (!user) return fallback || "No linked account";
  return user.name ? `${user.name} <${user.email}>` : user.email;
}

async function notifyTeam(req, { kind, text, authorId, authorFallback, reporterId, listingId }) {
  try {
    const ids = [authorId, reporterId].filter(Boolean);
    const [{ data: users }, { data: listing }] = await Promise.all([
      supabase.from("users").select("id, name, email").in("id", ids),
      listingId
        ? supabase.from("listings").select("id, title, address").eq("id", listingId).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    const byId = Object.fromEntries((users ?? []).map((u) => [u.id, u]));
    await sendContentReportEmail({
      kind,
      text,
      author: describeUser(byId[authorId], authorFallback),
      reporter: describeUser(byId[reporterId]),
      listingLabel: listing?.title || listing?.address || null,
      listingUrl: listing ? `${getBaseUrl()}/listings/${listing.id}?listingTab=reviews` : null,
      req,
    });
  } catch (err) {
    console.error("[reviewReport] team email failed:", err?.message || err);
  }
}
