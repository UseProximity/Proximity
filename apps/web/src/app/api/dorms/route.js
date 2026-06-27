import { NextResponse } from "next/server";
import supabase from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET() {
  const { data: dorms, error } = await supabase
    .from("dorms")
    .select("*, dorm_room_types(room_type)");

  if (error) {
    console.error("GET /api/dorms failed:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }

  return NextResponse.json(dorms || []);
}
