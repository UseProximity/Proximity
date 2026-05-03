import { NextResponse } from "next/server";
import supabase from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const dormName = searchParams.get("dorm");

  const SELECT = "*, dorms(name), dorm_review_tags(tags(name))";

  let query = supabase
    .from("dorm_reviews")
    .select(SELECT)
    .order("created_at", { ascending: false });

  if (dormName) {
    // Resolve dorm name → id first; dot-path filtering on joined tables is not supported in PostgREST
    const { data: dormRecord } = await supabase
      .from("dorms")
      .select("id")
      .eq("name", dormName)
      .maybeSingle();

    if (!dormRecord) {
      return NextResponse.json([]);
    }

    query = supabase
      .from("dorm_reviews")
      .select(SELECT)
      .eq("dorm_id", dormRecord.id)
      .order("created_at", { ascending: false });
  }

  const { data: reviews, error } = await query;

  if (error) {
    console.error("GET /api/dormReviews failed:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }

  return NextResponse.json(reviews || []);
}

export async function POST(req) {
  try {
    const body = await req.json();
    const { name, classYear, rating, dorm, dormType, tags, content } = body;

    if (!name?.trim() || !classYear || !rating || !dorm || !content?.trim()) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }
    if (rating < 1 || rating > 5) {
      return NextResponse.json({ error: "Rating must be 1–5" }, { status: 400 });
    }
    if (content.trim().length < 10) {
      return NextResponse.json({ error: "Review too short" }, { status: 400 });
    }

    // Resolve dorm name → dorm_id
    const { data: dormRecord, error: dormError } = await supabase
      .from("dorms")
      .select("id")
      .eq("name", dorm)
      .single();

    if (dormError || !dormRecord) {
      return NextResponse.json({ error: "Dorm not found" }, { status: 404 });
    }

    const { data: review, error: insertError } = await supabase
      .from("dorm_reviews")
      .insert({
        dorm_id: dormRecord.id,
        reviewer_name: name.trim(),
        class_year: Number(classYear),
        rating,
        dorm_type: dormType,
        tags: Array.isArray(tags) ? tags : [],
        content: content.trim(),
      })
      .select()
      .single();

    if (insertError) {
      console.error("POST /api/dormReviews failed:", insertError);
      return NextResponse.json({ error: "Server error" }, { status: 500 });
    }

    return NextResponse.json(review, { status: 201 });
  } catch (e) {
    console.error("POST /api/dormReviews failed:", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
