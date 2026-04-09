export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import supabase from "@/libs/supabase";

export async function GET(req) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Fetch the requesting user's role
    const { data: reqUser } = await supabase
      .from("users")
      .select("role")
      .eq("email", session.user.email)
      .single();

    if (reqUser?.role !== "super") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const q = (searchParams.get("q") || "").trim();

    if (!q || q.length < 2) {
      return NextResponse.json([]);
    }

    const { data: users, error } = await supabase
      .from("users")
      .select("id, name, email, role")
      .or(`name.ilike.%${q}%,email.ilike.%${q}%`)
      .limit(10);

    if (error) {
      console.error("searchUsers error:", error);
      return NextResponse.json({ error: "Server error" }, { status: 500 });
    }

    return NextResponse.json(users || []);
  } catch (e) {
    console.error("GET /api/searchUsers failed:", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
