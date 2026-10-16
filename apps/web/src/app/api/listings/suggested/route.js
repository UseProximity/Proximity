import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/getRequestUser";
import { getCachedListings, campusWalkMinutes } from "@/lib/listings/queryListings";
import { loadSuggestionSignals } from "@/lib/listings/suggestionSignals";
import { buildTasteProfile, suggestListings } from "@/lib/listings/suggestListings";
import { fetchSaturation } from "@/lib/matchmaking/saturation";

/**
 * @auth optional
 *
 * GET /api/listings/suggested
 * The signed-in student's "Suggested for you" listing ids, best first: 0, 2 or
 * 4 of them. Ids only; /browse and the homepage already hold the listing
 * objects. Signed out, or below the two-data-point minimum, returns
 * { ids: [] } and the caller shows its normal content.
 *
 * Per-user, so never cached. The shared listing feed it ranks is the same
 * 5-minute server cache the pages render from.
 */
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };

export async function GET(req) {
  try {
    const user = await getRequestUser(req);
    if (!user?.id) return NextResponse.json({ ids: [] }, { headers: NO_STORE });

    const [listings, signals, saturation] = await Promise.all([
      getCachedListings(),
      loadSuggestionSignals(user.id),
      fetchSaturation(),
    ]);
    const listingsById = new Map(listings.map((l) => [String(l._id), l]));
    const profile = buildTasteProfile(signals, listingsById, campusWalkMinutes);
    const ids = suggestListings({
      listings,
      profile,
      campusMinutes: campusWalkMinutes,
      saturation,
    });
    return NextResponse.json({ ids }, { headers: NO_STORE });
  } catch (err) {
    console.error("[suggested] failed:", err?.message ?? err);
    // Suggestions are an enhancement: fail to "none", never to an error state.
    return NextResponse.json({ ids: [] }, { headers: NO_STORE });
  }
}
