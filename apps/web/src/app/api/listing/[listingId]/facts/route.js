/*
 * GET /api/listing/[listingId]/facts
 *
 * A listing's current knowledge, student-safe, by section (fees, policies,
 * specials, misc). The read API for downstream consumers (form-based
 * matchmaking, the mobile app) and for Proxy's own context. Core values
 * (rent, beds, availability) are not here: read them from /api/listing/[id].
 *
 * Public, like the listing itself. Nothing in the response names a source.
 *
 * @auth public
 */
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { studentFacts } from "@/lib/agents/studentView";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_req, { params }) {
  const { listingId } = await params;
  if (!UUID.test(listingId ?? "")) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: listing } = await supabase
    .from("listings").select("id, deleted_at, published_at").eq("id", listingId).maybeSingle();
  if (!listing || listing.deleted_at || !listing.published_at) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const facts = await studentFacts(listingId);
    return NextResponse.json(facts, {
      headers: { "Cache-Control": "public, max-age=0, s-maxage=60, stale-while-revalidate=300" },
    });
  } catch (err) {
    console.error("[agents] facts read failed:", err);
    return NextResponse.json({ error: "Could not load listing details" }, { status: 500 });
  }
}
