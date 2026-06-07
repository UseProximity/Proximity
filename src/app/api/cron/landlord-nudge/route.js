/*
 * Daily cron: nudge new landlords who haven't listed yet.
 *
 * Triggered once a day by Vercel Cron (see vercel.json). Finds landlord accounts
 * created in the last 24 hours that have zero listings, and emails each a friendly
 * "Having trouble?" nudge offering help posting their first listing.
 *
 * Windowing: a fixed daily run + an exact 24h lookback tiles the timeline into
 * back-to-back, non-overlapping windows, so each new landlord is caught exactly
 * once — no duplicates, no misses (barring a fully failed run that day).
 *
 * Security: protected by a CRON_SECRET bearer token. Vercel Cron automatically
 * sends `Authorization: Bearer ${CRON_SECRET}` when the env var is set.
 */
import { NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { sendLandlordNudgeEmail } from "@/lib/email";

export const dynamic = "force-dynamic";

const WINDOW_MS = 24 * 60 * 60 * 1000;

export async function GET(req) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: landlordRole } = await supabase
    .from("roles")
    .select("id")
    .eq("name", "landlord")
    .single();

  if (!landlordRole?.id) {
    return NextResponse.json({ error: "landlord role not found" }, { status: 500 });
  }

  const since = new Date(Date.now() - WINDOW_MS).toISOString();

  // New landlords created in the last 24h (exclude soft-deleted accounts).
  const { data: newLandlords, error: usersError } = await supabase
    .from("users")
    .select("id, name, email")
    .eq("role_id", landlordRole.id)
    .is("deleted_at", null)
    .gte("created_at", since);

  if (usersError) {
    return NextResponse.json({ error: usersError.message }, { status: 500 });
  }

  const candidates = (newLandlords ?? []).filter((u) => u.email);
  if (candidates.length === 0) {
    return NextResponse.json({ checked: 0, nudged: 0 });
  }

  // Of those, find which already own at least one listing.
  const { data: owned, error: ownedError } = await supabase
    .from("listing_landlords")
    .select("user_id")
    .in("user_id", candidates.map((u) => u.id));

  if (ownedError) {
    return NextResponse.json({ error: ownedError.message }, { status: 500 });
  }

  const hasListing = new Set((owned ?? []).map((r) => r.user_id));
  const toNudge = candidates.filter((u) => !hasListing.has(u.id));

  let nudged = 0;
  for (const landlord of toNudge) {
    try {
      await sendLandlordNudgeEmail({ email: landlord.email, name: landlord.name });
      nudged += 1;
    } catch (err) {
      console.error(`landlord-nudge: failed to email ${landlord.id}`, err);
    }
  }

  return NextResponse.json({ checked: candidates.length, nudged });
}
