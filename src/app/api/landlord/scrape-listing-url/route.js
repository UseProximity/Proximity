import { NextResponse } from "next/server";
import { auth } from "@/auth";
import supabase from "@/lib/supabase";
import { scrapeListingUrl } from "@/lib/extraction/scrapeListingUrl";

// POST /api/landlord/scrape-listing-url
// Fetches an external listing URL and uses Anthropic to extract listing data.
// Body: { listing_id, url: string }
//
// This route is a stub pending §8 (AI extraction pipeline).
// When implemented it will:
//   1. Fetch the URL (handle 403 gracefully — surface message to landlord)
//   2. Call src/lib/extraction/scrapeListingUrl.ts with the HTML
//   3. Write lease_extraction_runs (run_type='private_listing_link_scrape')
//   4. Upsert listing_field_states with state='ai_suggested' for extracted fields
export async function POST(req) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { listing_id, url } = await req.json();
  if (!listing_id || !url?.trim())
    return NextResponse.json({ error: "listing_id and url required" }, { status: 400 });

  let parsedUrl;
  try { parsedUrl = new URL(url); } catch {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
  }
  if (!["http:", "https:"].includes(parsedUrl.protocol))
    return NextResponse.json({ error: "URL must be http or https" }, { status: 400 });

  const { data: own } = await supabase
    .from("listing_landlords")
    .select("listing_id")
    .eq("listing_id", listing_id)
    .eq("user_id", session.user.id)
    .maybeSingle();
  if (!own && session.user.role !== "super")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  if (!process.env.ANTHROPIC_API_KEY)
    return NextResponse.json({ error: "AI extraction not configured" }, { status: 503 });

  // Pre-flight: check if the URL is reachable
  let fetchOk = true;
  try {
    const probe = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(5000) });
    if (probe.status === 403) fetchOk = false;
  } catch { fetchOk = false; }

  if (!fetchOk) {
    return NextResponse.json({
      error: "This site is blocking us — please fill in fields manually.",
      code: "BLOCKED",
    }, { status: 422 });
  }

  try {
    const result = await scrapeListingUrl(listing_id, url, session.user.id);
    return NextResponse.json(result);
  } catch (err) {
    if (err.code === "BLOCKED") {
      return NextResponse.json({ error: err.message, code: "BLOCKED" }, { status: 422 });
    }
    console.error("[scrape-listing-url]", err.message);
    return NextResponse.json({ error: "Couldn't read this site — please fill in fields manually." }, { status: 500 });
  }
}
