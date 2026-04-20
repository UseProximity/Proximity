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

    // Fetch the requesting user's role via the roles join
    const { data: reqUser } = await supabase
      .from("users")
      .select("roles!role_id(name)")
      .eq("email", session.user.email)
      .single();

    if (reqUser?.roles?.name !== "super") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const q = (searchParams.get("q") || "").trim();

    if (!q || q.length < 2) {
      return NextResponse.json([]);
    }

    const { data: users, error } = await supabase
      .from("users")
      .select("id, name, email, roles!role_id(name)")
      .or(`name.ilike.%${q}%,email.ilike.%${q}%`)
      .limit(10);

    if (error) {
      console.error("searchUsers error:", error);
      return NextResponse.json({ error: "Server error" }, { status: 500 });
    }

    return NextResponse.json(
      (users || []).map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.roles?.name ?? "student",
      }))
    );
  } catch (e) {
    console.error("GET /api/searchUsers failed:", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
