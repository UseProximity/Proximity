// @auth super
import { NextResponse } from "next/server";
import { requireDbRole } from "@/lib/userRole";
import supabase from "@/lib/supabase";
import { fillBikeTimes } from "@/lib/findYourPlace/commute";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const BATCH = 10;

// Backfill bike-to-campus times (listing_bike_times) for every listing that has
// coordinates. Resumable: only listings with no row are computed, unless
// ?force=true. Mirrors update-listing-drive-times. Runs against the
// environment's own database (dev locally and on staging, prod in production).
export async function POST(req) {
  try {
    const session = await requireDbRole(["super"]);
    if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const force = new URL(req.url).searchParams.get("force") === "true";

    const [{ data: listings, error: listErr }, { data: existing, error: existErr }] = await Promise.all([
      supabase.from("listings").select("id, latitude, longitude").is("deleted_at", null).not("latitude", "is", null).not("longitude", "is", null),
      supabase.from("listing_bike_times").select("listing_id"),
    ]);
    if (listErr) return NextResponse.json({ error: listErr.message }, { status: 500 });
    if (existErr) return NextResponse.json({ error: existErr.message }, { status: 500 });

    const have = new Set((existing ?? []).map((r) => r.listing_id));
    const todo = (listings ?? []).filter((l) => force || !have.has(l.id));
    let updated = 0;
    for (let i = 0; i < todo.length; i += BATCH) {
      updated += Object.keys(await fillBikeTimes(todo.slice(i, i + BATCH))).length;
      await sleep(250);
    }
    return NextResponse.json({ total: listings?.length ?? 0, attempted: todo.length, updated, failed: todo.length - updated });
  } catch (err) {
    console.error("[update-listing-bike-times]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
