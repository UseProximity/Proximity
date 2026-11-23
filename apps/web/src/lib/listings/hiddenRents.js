/*
 * Hidden website prices (Wyatt, 2026-11-20; table lease_hidden_rents).
 *
 * A lease with no public rent is the landlord's choice. When their own
 * website shows a price anyway, the source sync keeps it here. It is used in
 * two places only, and is never shown as a figure:
 *   - Find Your Place ranks with it, so an unpriced place can still be judged
 *     against a student's budget ("Likely in your budget").
 *   - Proxy may give a rough range, rounded out to the nearest $100.
 * Admins see it in the listing's admin view. Landlords and students never do.
 *
 * Server only: the table is service-role only.
 */
import supabase from "@/lib/supabase";

// A price the website has not shown for this long is too old to rank with.
export const HIDDEN_RENT_MAX_AGE_DAYS = 30;

const freshSince = () => new Date(Date.now() - HIDDEN_RENT_MAX_AGE_DAYS * 86400000).toISOString();

/*
 * Fresh hidden prices for the given listings: Map leaseId -> { rent, perPerson, seenAt }.
 * A failed read is an empty map, so ranking carries on without them.
 */
export async function loadHiddenRents(listingIds) {
  const out = new Map();
  const ids = [...new Set((listingIds ?? []).filter(Boolean))];
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase
      .from("lease_hidden_rents")
      .select("lease_id, rent, rent_is_per_person, seen_at")
      .in("listing_id", ids.slice(i, i + 200))
      .gte("seen_at", freshSince());
    if (error) {
      console.error("[hiddenRents] read failed:", error.message);
      return new Map();
    }
    for (const r of data ?? []) {
      const rent = Number(r.rent);
      if (rent > 0) out.set(r.lease_id, { rent, perPerson: r.rent_is_per_person ?? null, seenAt: r.seen_at });
    }
  }
  return out;
}

/*
 * Listings with each blank-rent lease given its fresh hidden price, for
 * ranking only. Returns a copy (the input is untouched) and the ids of the
 * leases that were filled, so callers can tell a hidden price from a public
 * one and never show it. A lease with a public rent is never changed.
 */
export function withHiddenRents(listings, hidden) {
  const hiddenLeaseIds = new Set();
  if (!hidden?.size) return { listings, hiddenLeaseIds };
  const filled = listings.map((listing) => ({
    ...listing,
    listing_units: (listing.listing_units ?? []).map((u) => ({
      ...u,
      unit_leases: (u.unit_leases ?? []).map((l) => {
        const h = Number(l.rent) > 0 ? null : hidden.get(l.id);
        if (!h) return l;
        hiddenLeaseIds.add(l.id);
        return { ...l, rent: h.rent, rent_is_per_person: h.perPerson ?? l.rent_is_per_person ?? null };
      }),
    })),
  }));
  return { listings: filled, hiddenLeaseIds };
}

/*
 * A rough price range for Proxy: the cheapest to the priciest hidden price,
 * rounded out to the nearest $100 (Wyatt, 2026-11-20: a range, never the
 * exact figure). Per person and whole-unit prices are kept apart. A single
 * price still reads as a $100 band, so the figure itself never shows.
 * Returns e.g. "about $1,300 to $2,100 a month per person", or null.
 */
export function roughRangeText(prices) {
  const dollars = (n) => `$${n.toLocaleString("en-US")}`;
  const band = (rents) => {
    if (!rents.length) return null;
    let low = Math.floor(Math.min(...rents) / 100) * 100;
    let high = Math.ceil(Math.max(...rents) / 100) * 100;
    if (high <= low) high = low + 100;
    if (low <= 0) low = 100;
    return `${dollars(low)} to ${dollars(high)}`;
  };
  const per = band(prices.filter((p) => p.perPerson === true).map((p) => p.rent));
  const whole = band(prices.filter((p) => p.perPerson !== true).map((p) => p.rent));
  const parts = [per && `about ${per} a month per person`, whole && `about ${whole} a month${per ? " for a whole unit" : ""}`].filter(Boolean);
  return parts.length ? parts.join(", and ") : null;
}

/*
 * Save what the sync read: rows of { leaseId, rent, perPerson }. An existing
 * row is replaced and its seen_at refreshed. Never touches unit_leases.
 */
export async function saveHiddenRents({ listingId, rows, sourceUrl = null }) {
  const clean = (rows ?? []).filter((r) => r.leaseId && Number(r.rent) > 0 && Number(r.rent) < 100000);
  if (!clean.length) return 0;
  const now = new Date().toISOString();
  const { error } = await supabase.from("lease_hidden_rents").upsert(
    clean.map((r) => ({
      lease_id: r.leaseId,
      listing_id: listingId,
      rent: Number(r.rent),
      rent_is_per_person: r.perPerson ?? null,
      source_url: sourceUrl,
      seen_at: now,
      updated_at: now,
    })),
    { onConflict: "lease_id" }
  );
  if (error) {
    console.error("[hiddenRents] save failed:", error.message);
    return 0;
  }
  return clean.length;
}

/*
 * The sync read the website and it had not changed since the last read: the
 * prices it showed then are still showing, so their hidden copies are fresh.
 */
export async function touchHiddenRents(listingId) {
  if (!listingId) return;
  const { error } = await supabase.from("lease_hidden_rents").update({ seen_at: new Date().toISOString() }).eq("listing_id", listingId);
  if (error) console.error("[hiddenRents] touch failed:", error.message);
}
