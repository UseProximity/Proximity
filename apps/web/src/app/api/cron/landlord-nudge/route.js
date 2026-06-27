/*
 * Daily cron: nudge new landlords who haven't listed yet.
 *
 * Triggered once a day by Vercel Cron (see vercel.json). Finds landlord accounts
 * created between 12 and 36 hours ago that have zero listings, and emails each a
 * friendly "Having trouble?" nudge offering help posting their first listing.
 *
 * Windowing: nudging is delayed by at least 12h so a landlord isn't emailed
 * immediately after signing up. The window is still 24h wide (12h–36h ago), so a
 * fixed daily run tiles the timeline into back-to-back, non-overlapping windows,
 * and each new landlord is caught exactly once — no duplicates, no misses
 * (barring a fully failed run that day).
 *
 * Security: protected by a CRON_SECRET bearer token. Vercel Cron automatically
 * sends `Authorization: Bearer ${CRON_SECRET}` when the env var is set.
 */
import { NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { sendLandlordNudgeEmail } from "@/lib/email";

export const dynamic = "force-dynamic";

const MIN_AGE_MS = 12 * 60 * 60 * 1000; // skip landlords newer than this (don't nudge right after signup)
const MAX_AGE_MS = 36 * 60 * 60 * 1000; // and older than this (already covered by a previous run)

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

  const now = Date.now();
  const since = new Date(now - MAX_AGE_MS).toISOString(); // oldest: 36h ago
  const until = new Date(now - MIN_AGE_MS).toISOString(); // newest: 12h ago

  // New landlords created between 12h and 36h ago (exclude soft-deleted accounts).
  const { data: newLandlords, error: usersError } = await supabase
    .from("users")
    .select("id, name, email")
    .eq("role_id", landlordRole.id)
    .is("deleted_at", null)
    .gte("created_at", since)
    .lte("created_at", until);

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
