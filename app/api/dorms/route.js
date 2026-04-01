import { NextResponse } from "next/server";
import supabase from "@/libs/supabase";

export const dynamic = "force-dynamic";

export async function GET() {
  const { data: dorms, error } = await supabase
    .from("dorms")
    .select("*");

  if (error) {
    console.error("GET /api/dorms failed:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }

  return NextResponse.json(dorms || []);
}
