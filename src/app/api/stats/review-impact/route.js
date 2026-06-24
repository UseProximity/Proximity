/*
 * GET /api/stats/review-impact
 *
 * Platform-wide aggregate: average contact count per listing, bucketed by review
 * count (0 | 1-2 | 3-4 | 5-9 | 10+). Returns lift ratios vs the 0-review
 * baseline for use by landlord dashboard nudge cards (Slice 4+).
 *
 * Cached hourly — scans the full interactions table on cold compute.
 * Public read (no PII).
 */

import supabase from "@/lib/supabase";

export const revalidate = 3600;

const BUCKETS = ["0", "1-2", "3-4", "5-9", "10+"];
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function bucketFor(reviewCount) {
  if (reviewCount === 0) return "0";
  if (reviewCount <= 2) return "1-2";
  if (reviewCount <= 4) return "3-4";
  if (reviewCount <= 9) return "5-9";
  return "10+";
}

export async function GET() {
  try {
    const [listingsRes, landlordRowsRes, reviewRowsRes, typeRowRes] =
      await Promise.all([
        supabase
          .from("listings")
          .select("id, contact_email, contact_phone, unavailable, created_at")
          .is("deleted_at", null),
        supabase.from("listing_landlords").select("listing_id"),
        supabase
          .from("listing_reviews")
          .select("listing_id, legitimacy, deleted_at"),
        supabase
          .from("interaction_types")
          .select("id")
          .eq("name", "contacted")
          .maybeSingle(),
      ]);

    if (listingsRes.error) throw listingsRes.error;
    if (landlordRowsRes.error) throw landlordRowsRes.error;
    if (reviewRowsRes.error) throw reviewRowsRes.error;
    if (typeRowRes.error) throw typeRowRes.error;

    const listings = listingsRes.data ?? [];
    const hasLandlord = new Set(
      (landlordRowsRes.data ?? []).map((r) => r.listing_id)
    );

    const reviewCount = {};
    for (const r of reviewRowsRes.data ?? []) {
      if (r.legitimacy && !r.deleted_at) {
        reviewCount[r.listing_id] = (reviewCount[r.listing_id] ?? 0) + 1;
      }
    }

    let contactRows = [];
    if (typeRowRes.data?.id) {
      const { data, error } = await supabase
        .from("user_listing_interactions")
        .select("listing_id")
        .eq("interaction_type_id", typeRowRes.data.id);
      if (error) throw error;
      contactRows = data ?? [];
    }

    const contactCount = {};
    for (const r of contactRows) {
      contactCount[r.listing_id] = (contactCount[r.listing_id] ?? 0) + 1;
    }

    const now = Date.now();
    const eligible = listings.filter((l) => {
      if (l.unavailable) return false;
      const reachable =
        l.contact_email || l.contact_phone || hasLandlord.has(l.id);
      if (!reachable) return false;
      const ageMs = now - new Date(l.created_at).getTime();
      const contacts = contactCount[l.id] ?? 0;
      if (ageMs < THIRTY_DAYS_MS && contacts === 0) return false;
      return true;
    });

    const totals = Object.fromEntries(
      BUCKETS.map((b) => [b, { n: 0, totalContacts: 0 }])
    );

    for (const l of eligible) {
      const bucket = bucketFor(reviewCount[l.id] ?? 0);
      const contacts = contactCount[l.id] ?? 0;
      totals[bucket].n += 1;
      totals[bucket].totalContacts += contacts;
    }

    const summary = Object.fromEntries(
      BUCKETS.map((b) => [
        b,
        {
          n: totals[b].n,
          avgContacts:
            totals[b].n > 0 ? totals[b].totalContacts / totals[b].n : 0,
        },
      ])
    );

    const baseline = summary["0"].avgContacts;
    const lift =
      baseline > 0 && summary["0"].n > 0
        ? Object.fromEntries(
            BUCKETS.map((b) => [
              b,
              summary[b].n > 0 ? summary[b].avgContacts / baseline : null,
            ])
          )
        : null;

    return Response.json({
      summary,
      lift,
      computedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[stats/review-impact GET] unexpected error:", err);
    return Response.json(
      { error: "Failed to compute review impact stats" },
      { status: 500 }
    );
  }
}
