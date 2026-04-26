import { NextResponse } from "next/server";
import { auth } from "@/auth";
import supabase from "@/libs/supabase";
import { insertAsUser, updateAsUser, deleteAsUser } from "@/libs/supabaseWithUser";

export async function POST(req) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { reviewId, vote } = await req.json();
    if (!reviewId || !["up", "down"].includes(vote)) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const userId = session.user.id;

    // Validate review exists
    const { data: review, error: fetchError } = await supabase
      .from("listing_reviews")
      .select("id")
      .eq("id", reviewId)
      .single();

    if (fetchError || !review) {
      return NextResponse.json({ error: "Review not found" }, { status: 404 });
    }

    // Check for an existing vote by this user on this review
    const { data: existingVote } = await supabase
      .from("review_votes")
      .select("vote")
      .eq("review_id", reviewId)
      .eq("user_id", userId)
      .maybeSingle();

    if (existingVote) {
      if (existingVote.vote === vote) {
        // Same direction — toggle off (delete)
        const { error: deleteError } = await deleteAsUser(supabase, {
          userId,
          table: "review_votes",
          match: { review_id: reviewId, user_id: userId },
        });

        if (deleteError) {
          console.error("POST /api/reviewVote delete failed:", deleteError);
          return NextResponse.json({ error: "Server error" }, { status: 500 });
        }
      } else {
        // Different direction — update to new vote
        const { error: updateError } = await updateAsUser(supabase, {
          userId,
          table: "review_votes",
          data: { vote },
          match: { review_id: reviewId, user_id: userId },
        });

        if (updateError) {
          console.error("POST /api/reviewVote update failed:", updateError);
          return NextResponse.json({ error: "Server error" }, { status: 500 });
        }
      }
    } else {
      // No existing vote — insert
      const { error: insertError } = await insertAsUser(supabase, {
        userId,
        table: "review_votes",
        data: { review_id: reviewId, user_id: userId, vote },
      });

      if (insertError) {
        console.error("POST /api/reviewVote insert failed:", insertError);
        return NextResponse.json({ error: "Server error" }, { status: 500 });
      }
    }

    // Return updated counts and current user vote
    const { data: votes } = await supabase
      .from("review_votes")
      .select("user_id, vote")
      .eq("review_id", reviewId);

    const upvotes = (votes ?? []).filter((v) => v.vote === "up").length;
    const downvotes = (votes ?? []).filter((v) => v.vote === "down").length;
    const userVote = (votes ?? []).find((v) => v.user_id === userId)?.vote ?? null;

    return NextResponse.json({ upvotes, downvotes, userVote });
  } catch (e) {
    console.error("POST /api/reviewVote failed:", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
