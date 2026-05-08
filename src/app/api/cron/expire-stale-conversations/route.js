import { NextResponse } from "next/server";
import supabase from "@/lib/supabase";

// POST /api/cron/expire-stale-conversations
// Vercel cron schedule: 0 6 * * * (daily at 06:00 UTC)
// Flips listing_active_conversations rows past expires_at to state='stale' and sets closed_at.
// Protected by CRON_SECRET header or Vercel's built-in cron auth header.
export async function POST(req) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const provided = req.headers.get("authorization")?.replace("Bearer ", "");
    if (provided !== secret) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("listing_active_conversations")
    .update({ state: "stale", closed_at: new Date().toISOString() })
    .lt("expires_at", new Date().toISOString())
    .is("closed_at", null)
    .neq("state", "leased")   // don't expire completed conversations
    .select("id");

  if (error) {
    console.error("[cron/expire-stale-conversations]", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ expired: data?.length ?? 0 });
}
