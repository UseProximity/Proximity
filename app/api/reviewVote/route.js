import { NextResponse } from "next/server";
import { auth } from "@/auth";
import supabase from "@/libs/supabase";

export async function POST(req) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { reviewId, vote } = await req.json();
    if (!reviewId || !["up", "down"].join("").includes(vote)) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const userId = session.user.id;
    const addCol = vote === "up" ? "upvotes" : "downvotes";
    const removeCol = vote === "up" ? "downvotes" : "upvotes";

    // Fetch current vote arrays
    const { data: review, error: fetchError } = await supabase
      .from("reviews")
      .select("id, upvotes, downvotes")
      .eq("id", reviewId)
      .single();

    if (fetchError || !review) {
      return NextResponse.json({ error: "Review not found" }, { status: 404 });
    }

    const addArr = Array.isArray(review[addCol]) ? review[addCol] : [];
    const removeArr = Array.isArray(review[removeCol]) ? review[removeCol] : [];

    const alreadyVoted = addArr.includes(userId);
    const newAddArr = alreadyVoted
      ? addArr.filter((id) => id !== userId) // toggle off
      : [...addArr, userId];
    const newRemoveArr = removeArr.filter((id) => id !== userId); // remove opposite vote

    const { data: updated, error: updateError } = await supabase
      .from("reviews")
      .update({ [addCol]: newAddArr, [removeCol]: newRemoveArr })
      .eq("id", reviewId)
      .select("id, upvotes, downvotes")
      .single();

    if (updateError) {
      console.error("POST /api/reviewVote update failed:", updateError);
      return NextResponse.json({ error: "Server error" }, { status: 500 });
    }

    return NextResponse.json({
      upvotes: updated.upvotes?.length ?? 0,
      downvotes: updated.downvotes?.length ?? 0,
      userVote: newAddArr.includes(userId) ? vote : null,
    });
  } catch (e) {
    console.error("POST /api/reviewVote failed:", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
