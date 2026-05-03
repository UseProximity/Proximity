import { NextResponse } from "next/server";
import supabase from "@/lib/supabase";

export async function GET() {
  const { data: testimonials, error } = await supabase
    .from("testimonials")
    .select("*")
    .order("created_at", { ascending: true });

  if (error) {
    console.error("GET /api/testimonials failed:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }

  return NextResponse.json(testimonials || []);
}
