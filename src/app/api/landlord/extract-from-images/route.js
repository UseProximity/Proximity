import { NextResponse } from "next/server";
import { auth } from "@/auth";
import supabase from "@/lib/supabase";
import { extractAmenitiesFromImages } from "@/lib/extraction/listingImages";

// POST /api/landlord/extract-from-images
// Triggers a vision pass on listing photos to suggest amenity/utility states.
// Body: { listing_id, image_urls: string[] }
//
// This route is a stub pending §8 (AI extraction pipeline).
// When implemented it will:
//   1. Call src/lib/extraction/listingImages.ts with the image URLs
//   2. Write lease_extraction_runs (run_type='image_amenity_extraction')
//   3. Upsert listing_field_states rows with state='ai_suggested' for each detected amenity
export async function POST(req) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { listing_id, image_urls } = await req.json();
  if (!listing_id || !Array.isArray(image_urls) || image_urls.length === 0)
    return NextResponse.json({ error: "listing_id and image_urls required" }, { status: 400 });

  // Ownership check
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

  try {
    const result = await extractAmenitiesFromImages(listing_id, image_urls, session.user.id);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[extract-from-images]", err.message);
    return NextResponse.json({ error: "Couldn't analyse these images — please fill in fields manually." }, { status: 500 });
  }
}
