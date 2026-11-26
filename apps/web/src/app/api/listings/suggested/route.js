import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/getRequestUser";
import { getCachedListings, campusWalkMinutes } from "@/lib/listings/queryListings";
import { loadSuggestionSignals, loadAnchorListing } from "@/lib/listings/suggestionSignals";
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
 * ?similar=<listingId> is "similar to" mode, used by the chat's no-reply note
 * (Wyatt, 2026-10-16): ranked mostly by resemblance to that listing, and open
 * to signed-out visitors too since it needs no personal data. When the listing
 * is gone or fewer than two places fit, it falls back to the normal
 * suggestions. The response says which it gave:
 *   { ids, mode: "similar" | "suggested", anchorLabel }
 *
 * Per-user, so never cached. The shared listing feed it ranks is the same
 * 5-minute server cache the pages render from.
 */
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMPTY_SIGNALS = { sessions: [], interactions: [], filterSummary: null, gender: null };

// The listing's name, else the street part of its address.
function anchorLabelOf(listing) {
  const title = String(listing?.title ?? "").trim();
  if (title) return title;
  return String(listing?.address ?? "").split(",")[0].trim() || null;
}

export async function GET(req) {
  try {
    const user = await getRequestUser(req);
    const similarParam = new URL(req.url).searchParams.get("similar");
    const similar = similarParam && UUID_RE.test(similarParam) ? similarParam : null;
    if (!user?.id && !similar) return NextResponse.json({ ids: [], mode: "suggested" }, { headers: NO_STORE });

    const [listings, signals, saturation] = await Promise.all([
      getCachedListings(),
      user?.id ? loadSuggestionSignals(user.id) : EMPTY_SIGNALS,
      fetchSaturation(),
    ]);
    const listingsById = new Map(listings.map((l) => [String(l._id), l]));
    const profile = buildTasteProfile(signals, listingsById, campusWalkMinutes);
    const base = { listings, profile, campusMinutes: campusWalkMinutes, saturation };

    if (similar) {
      const anchor = await loadAnchorListing(similar, listings);
      if (anchor) {
        const ids = suggestListings({ ...base, anchor });
        if (ids.length >= 2) {
          return NextResponse.json(
            { ids, mode: "similar", anchorLabel: anchorLabelOf(anchor.listing) },
            { headers: NO_STORE }
          );
        }
      }
      if (!user?.id) return NextResponse.json({ ids: [], mode: "suggested" }, { headers: NO_STORE });
    }

    const ids = suggestListings(base);
    return NextResponse.json({ ids, mode: "suggested" }, { headers: NO_STORE });
  } catch (err) {
    console.error("[suggested] failed:", err?.message ?? err);
    // Suggestions are an enhancement: fail to "none", never to an error state.
    return NextResponse.json({ ids: [], mode: "suggested" }, { headers: NO_STORE });
  }
}
