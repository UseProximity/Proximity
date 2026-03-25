import { NextResponse } from "next/server";
import connectMongo from "@/libs/mongoose";
import DormReview from "@/models/DormReview";

export const dynamic = "force-dynamic";

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const dorm = searchParams.get("dorm");
  await connectMongo();
  const query = dorm ? { dorm } : {};
  const reviews = await DormReview.find(query).sort({ createdAt: -1 }).lean();
  return NextResponse.json(reviews);
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

    await connectMongo();
    const review = await DormReview.create({
      name: name.trim(),
      classYear: Number(classYear),
      rating,
      dorm,
      dormType,
      tags: Array.isArray(tags) ? tags : [],
      content: content.trim(),
    });
    return NextResponse.json(review, { status: 201 });
  } catch (e) {
    console.error("POST /api/dormReviews failed:", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
