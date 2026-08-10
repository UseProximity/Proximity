import supabase from "@/lib/supabase";
import { fetchListings } from "../route";

// GET /api/listings/popular
// Ranks available listings by engagement (saves + contacts, each worth 1 point)
// using a recency-weighted tiebreak chain so the front-page "Popular rentals"
// row reflects what students are actually pursuing right now:
//   1) saves + contacts in the last 7 days   (desc)
//   2) tiebreak — last 30 days               (desc)
//   3) tiebreak — all time                   (desc)
//   4) tiebreak — newest listing             (keeps the row full + deterministic)
// Returns the top 6 listings, fully built (same shape as /api/listings).

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MONTH_MS = 30 * 24 * 60 * 60 * 1000;
const RESULT_COUNT = 6;

// Exported so the homepage can server-render the same ranked row (seeding the
// client component); GET below stays the client-refresh path.
export async function getPopularListings() {
  const listings = (await fetchListings()).filter((l) => !l.unavailable);

    // Saves and contacts both live in user_listing_interactions, keyed by type.
    const { data: types } = await supabase
      .from("interaction_types")
      .select("id, name")
      .in("name", ["saved", "contacted"]);
    const typeIds = (types ?? []).map((t) => t.id);

    // listingId -> { week, month, all } interaction counts
    const counts = new Map();
    if (typeIds.length > 0) {
      const { data: rows, error } = await supabase
        .from("user_listing_interactions")
        .select("listing_id, created_at")
        .in("interaction_type_id", typeIds);

      if (error) {
        console.error("[listings/popular GET] interaction fetch error:", error);
      }

      const now = Date.now();
      for (const r of rows ?? []) {
        const c = counts.get(r.listing_id) ?? { week: 0, month: 0, all: 0 };
        const age = now - new Date(r.created_at).getTime();
        if (age <= WEEK_MS) c.week += 1;
        if (age <= MONTH_MS) c.month += 1;
        c.all += 1;
        counts.set(r.listing_id, c);
      }
    }

    const zero = { week: 0, month: 0, all: 0 };
    const ranked = [...listings].sort((a, b) => {
      const ca = counts.get(a._id) ?? zero;
      const cb = counts.get(b._id) ?? zero;
      if (cb.week !== ca.week) return cb.week - ca.week;
      if (cb.month !== ca.month) return cb.month - ca.month;
      if (cb.all !== ca.all) return cb.all - ca.all;
      return new Date(b.createdAt ?? 0) - new Date(a.createdAt ?? 0);
    });

    return ranked.slice(0, RESULT_COUNT);
}

export async function GET() {
  try {
    return Response.json(await getPopularListings());
  } catch (err) {
    console.error("[listings/popular GET] unexpected error:", err);
    return Response.json(
      { error: "Failed to fetch popular listings" },
      { status: 500 }
    );
  }
}
