import { NextResponse } from "next/server";
import supabase from "@/lib/supabase";

// POST /api/cron/demote-stale-listings
// Vercel cron schedule: 30 6 * * * (daily at 06:30 UTC)
// Sets demoted_at on listings whose last_verified_at is older than 90 days.
// Consumer: matchmaking weight logic reads demoted_at and reduces score accordingly.
// Protected by CRON_SECRET header.
export async function POST(req) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const provided = req.headers.get("authorization")?.replace("Bearer ", "");
    if (provided !== secret) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("listings")
    .update({ demoted_at: new Date().toISOString() })
    .lt("last_verified_at", cutoff)
    .is("demoted_at", null)
    .is("deleted_at", null)
    .select("id");

  if (error) {
    console.error("[cron/demote-stale-listings]", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ demoted: data?.length ?? 0 });
}
