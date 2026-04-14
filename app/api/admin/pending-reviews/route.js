import { NextResponse } from "next/server";
import { auth } from "@/auth";
import supabase from "@/libs/supabase";

async function requireSuper() {
  const session = await auth();
  if (!session?.user?.email) return null;
  const { data: user } = await supabase
    .from("users")
    .select("id, role")
    .eq("email", session.user.email.toLowerCase())
    .single();
  if (!user || user.role !== "super") return null;
  return user;
}

export async function GET() {
  try {
    const user = await requireSuper();
    if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { data: reviews, error } = await supabase
      .from("reviews")
      .select("*, reviewer:users!reviews_user_id_fkey(name, email, image), listings(address, title)")
      .eq("legitimacy", false)
      .order("created_at", { ascending: false });

    if (error) throw error;
    return NextResponse.json(reviews || []);
  } catch (err) {
    console.error("admin/pending-reviews GET:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function PATCH(request) {
  try {
    const user = await requireSuper();
    if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { reviewId } = await request.json();
    if (!reviewId) return NextResponse.json({ error: "reviewId required" }, { status: 400 });

    const { data: review, error: fetchErr } = await supabase
      .from("reviews")
      .select("id, listing_id")
      .eq("id", reviewId)
      .single();
    if (fetchErr || !review) return NextResponse.json({ error: "Review not found" }, { status: 404 });

    await supabase.from("reviews").update({ legitimacy: true }).eq("id", reviewId);

    if (review.listing_id) {
      const { data: allReviews } = await supabase
        .from("reviews")
        .select("rating")
        .eq("listing_id", review.listing_id)
        .eq("legitimacy", true);
      const reviews = allReviews || [];
      const numReviews = reviews.length;
      const rating = numReviews > 0
        ? reviews.reduce((s, r) => s + r.rating, 0) / numReviews
        : 0;
      await supabase
        .from("listings")
        .update({ num_reviews: numReviews, rating })
        .eq("id", review.listing_id);
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("admin/pending-reviews PATCH:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const user = await requireSuper();
    if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { reviewId } = await request.json();
    if (!reviewId) return NextResponse.json({ error: "reviewId required" }, { status: 400 });

    const { data: review, error: fetchErr } = await supabase
      .from("reviews")
      .select("id, listing_id")
      .eq("id", reviewId)
      .single();
    if (fetchErr || !review) return NextResponse.json({ error: "Review not found" }, { status: 404 });

    await supabase.from("reviews").delete().eq("id", reviewId);

    if (review.listing_id) {
      const { data: allReviews } = await supabase
        .from("reviews")
        .select("rating")
        .eq("listing_id", review.listing_id)
        .eq("legitimacy", true);
      const reviews = allReviews || [];
      const numReviews = reviews.length;
      const rating = numReviews > 0
        ? reviews.reduce((s, r) => s + r.rating, 0) / numReviews
        : 0;
      await supabase
        .from("listings")
        .update({ num_reviews: numReviews, rating })
        .eq("id", review.listing_id);
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("admin/pending-reviews DELETE:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
