import { NextResponse } from "next/server";
import { auth } from "@/auth";
import supabase from "@/lib/supabase";
import { insertAsUser } from "@/lib/supabaseWithUser";

export async function POST(req) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();

    const { reviewId, reply } = body;

    if (!reviewId || !reply?.trim()) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
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
      console.error("POST /api/reviewReply failed:", error);

      return NextResponse.json({ error: "Server error" }, { status: 500 });
    }

    return NextResponse.json(newReply);
  } catch (e) {
    console.error("POST /api/reviewReply failed:", e);

    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
