/*
 * Manual property correction for a lease check: the student tells us the address (or a
 * landlord/company name), we geocode + match and return fresh property context. A manual
 * address correction is treated as high confidence — the student told us where they live.
 */
import supabase from "@/lib/supabase";
import { auth } from "@/auth";
import {
  matchListing,
  getReviews,
  getLandlordReviewsByName,
} from "@/lib/leaseCheck/propertyContext";

export const dynamic = "force-dynamic";

export async function POST(req) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { leaseCheckId, address, landlordName } = body || {};
    const hasAddress = typeof address === "string" && address.trim().length >= 5;
    const hasLandlord = typeof landlordName === "string" && landlordName.trim().length >= 3;
    if (!leaseCheckId || (!hasAddress && !hasLandlord)) {
      return Response.json(
        { error: "Give us a street address or a landlord name" },
        { status: 400 }
      );
    }

    const { data: check } = await supabase
      .from("lease_checks")
      .select("id")
      .eq("id", leaseCheckId)
      .eq("user_id", session.user.id)
      .is("deleted_at", null)
      .maybeSingle();
    if (!check) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }

    // Landlord/company-name lookup: reviews across that name's listings, no address
    // match required. Nothing is persisted for this path.
    if (!hasAddress) {
      const landlord = await getLandlordReviewsByName(landlordName);
      return Response.json({ landlord });
    }

    const { listing, geo } = await matchListing(address.trim());
    const confidence = listing ? "high" : "none";

    await supabase
      .from("lease_checks")
      .update({ matched_listing_id: listing?.id ?? null, match_confidence: confidence })
      .eq("id", leaseCheckId)
      .eq("user_id", session.user.id);

    if (!listing || !geo) {
      return Response.json({
        property: { matchConfidence: "none", listing: null, reviews: null },
      });
    }

    const reviews = await getReviews(listing);

    return Response.json({
      property: {
        matchConfidence: "high",
        listing: { id: listing.id, title: listing.title, address: listing.address },
        reviews,
      },
    });
  } catch (error) {
    console.error("[lease-check] property correction error:", error);
    return Response.json({ error: "Couldn't look that up. Try again?" }, { status: 500 });
  }
}
