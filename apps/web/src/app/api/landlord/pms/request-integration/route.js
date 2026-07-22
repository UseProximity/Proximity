export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import supabase from "@/lib/supabase";

/*
 * POST /api/landlord/pms/request-integration — a landlord tells us which
 * property management system they use so we can prioritize (and negotiate)
 * that connector. Body: { providerName }. One row per landlord per system;
 * repeats are treated as success so the button is always safe to press.
 */
export async function POST(req) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!["landlord", "super"].includes(session.user.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { providerName } = await req.json().catch(() => ({}));
  const name = typeof providerName === "string" ? providerName.trim() : "";
  if (name.length < 2 || name.length > 80) {
    return Response.json({ error: "Please enter the name of your property management system" }, { status: 400 });
  }

  const { error } = await supabase
    .from("pms_integration_requests")
    .insert({ user_id: session.user.id, provider_name: name });
  // 23505 = duplicate (same landlord, same system): already recorded, still a success.
  if (error && error.code !== "23505") {
    console.error("[pms/request-integration]", error.message);
    return NextResponse.json({ error: "Could not save your request" }, { status: 500 });
  }

  return Response.json({ ok: true });
}
