import supabase from "@/lib/supabase";
import { fetchListings } from "../route";
import { isSandboxViewer, SANDBOX_FEED_HEADERS, allSandboxUserIds } from "@/lib/reviewSandbox";

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
// client component); GET below stays the client-refresh path. `includeSandbox`
// is only for a review sandbox viewer in the app: their row leads with the
// sandbox listings (which have no real saves or contacts, so would otherwise
// never rank), then the real ranking fills the rest.
export async function getPopularListings({ includeSandbox = false } = {}) {
  const listings = (await fetchListings(null, { includeSandbox })).filter((l) => !l.unavailable);
  let sandboxIds = new Set();
  if (includeSandbox) {
    const { data: sandboxRows, error: sandboxErr } = await supabase
      .from("listings")
      .select("id")
      .eq("review_sandbox", true);
    if (sandboxErr) console.error("[listings/popular GET] sandbox listing fetch error:", sandboxErr);
    sandboxIds = new Set((sandboxRows ?? []).map((r) => r.id));
  }

    // Saves and contacts both live in user_listing_interactions, keyed by type.
    const { data: types } = await supabase
      .from("interaction_types")
      .select("id, name")
      .in("name", ["saved", "contacted"]);
    const typeIds = (types ?? []).map((t) => t.id);

    // listingId -> { week, month, all } interaction counts
    const counts = new Map();
    if (typeIds.length > 0) {
      const [{ data: rows, error }, sandboxUsers] = await Promise.all([
        supabase
          .from("user_listing_interactions")
          .select("listing_id, user_id, created_at")
          .in("interaction_type_id", typeIds),
        // Review sandbox accounts' saves and contacts never move the real ranking.
        // A failed lookup counts everyone, like the feeds serving the public view.
        allSandboxUserIds().catch(() => new Set()),
      ]);

      if (error) {
        console.error("[listings/popular GET] interaction fetch error:", error);
      }

      const now = Date.now();
      for (const r of rows ?? []) {
        if (sandboxUsers.has(r.user_id)) continue;
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
      const sa = sandboxIds.has(a._id) ? 1 : 0;
      const sb = sandboxIds.has(b._id) ? 1 : 0;
      if (sa !== sb) return sb - sa;
      const ca = counts.get(a._id) ?? zero;
      const cb = counts.get(b._id) ?? zero;
      if (cb.week !== ca.week) return cb.week - ca.week;
      if (cb.month !== ca.month) return cb.month - ca.month;
      if (cb.all !== ca.all) return cb.all - ca.all;
      return new Date(b.createdAt ?? 0) - new Date(a.createdAt ?? 0);
    });

    return ranked.slice(0, RESULT_COUNT);
}

export async function GET(req) {
  try {
    // A review sandbox account in the app gets its own row, never cached.
    if (await isSandboxViewer(req)) {
      return Response.json(await getPopularListings({ includeSandbox: true }), { headers: SANDBOX_FEED_HEADERS });
    }
    return Response.json(await getPopularListings());
  } catch (err) {
    console.error("[listings/popular GET] unexpected error:", err);
    return Response.json(
      { error: "Failed to fetch popular listings" },
      { status: 500 }
    );
  }
}
