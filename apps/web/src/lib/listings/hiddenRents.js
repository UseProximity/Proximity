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
// Pages of this many rows, under PostgREST's default 1,000 row cap.
const PAGE = 1000;

/*
 * Fresh hidden prices: Map leaseId -> { rent, perPerson, seenAt }. For the
 * given listings, or every listing when none are given (Find Your Place reads
 * them all alongside the active listings). Paged, so none are silently cut
 * off. A failed read is an empty map, so ranking carries on without them.
 */
export async function loadHiddenRents(listingIds = null) {
  const out = new Map();
  const ids = listingIds ? [...new Set(listingIds.filter(Boolean))] : null;
  if (ids && !ids.length) return out;
  for (let from = 0; ; from += PAGE) {
    let q = supabase
      .from("lease_hidden_rents")
      .select("lease_id, rent, rent_is_per_person, seen_at")
      .gte("seen_at", freshSince())
      .order("lease_id")
      .range(from, from + PAGE - 1);
    if (ids) q = q.in("listing_id", ids);
    const { data, error } = await q;
    if (error) {
      console.error("[hiddenRents] read failed:", error.message);
      return new Map();
    }
    for (const r of data ?? []) {
      const rent = Number(r.rent);
      if (rent > 0) out.set(r.lease_id, { rent, perPerson: r.rent_is_per_person ?? null, seenAt: r.seen_at });
    }
    if ((data ?? []).length < PAGE) return out;
  }
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
 * The $100 band around some prices, always strictly wider than them: the
 * low end is below the cheapest and the high end above the priciest, so
 * neither end is ever a real price (a $1,500 price reads "$1,400 to $1,600",
 * never "$1,500 to $1,600"). Returns { low, high } or null.
 */
export function roughBand(rents) {
  const clean = (rents ?? []).map(Number).filter((n) => n > 0);
  if (!clean.length) return null;
  const low = Math.max(0, Math.floor((Math.min(...clean) - 1) / 100) * 100);
  const high = Math.ceil((Math.max(...clean) + 1) / 100) * 100;
  return { low, high };
}

/*
 * A rough price range for Proxy (Wyatt, 2026-11-20: a range, never the exact
 * figure). Per person, whole unit and unstated prices are kept apart, and an
 * unstated one is never called per person or whole unit.
 * Returns e.g. "about $1,300 to $2,100 a month per person", or null.
 */
export function roughRangeText(prices) {
  const dollars = (n) => `$${n.toLocaleString("en-US")}`;
  const text = (rents) => {
    const b = roughBand(rents);
    return b ? `${dollars(b.low)} to ${dollars(b.high)}` : null;
  };
  const per = text(prices.filter((p) => p.perPerson === true).map((p) => p.rent));
  const whole = text(prices.filter((p) => p.perPerson === false).map((p) => p.rent));
  const unstated = text(prices.filter((p) => p.perPerson == null).map((p) => p.rent));
  const parts = [
    per && `about ${per} a month per person`,
    whole && `about ${whole} a month for a whole unit`,
    unstated && `about ${unstated} a month (not stated whether per person or for the whole unit)`,
  ].filter(Boolean);
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
 * A full read of one website settles that website's hidden prices (PR 478
 * review): what it priced is saved, and a row it read last time but no
 * longer prices (the plan went to "Call for pricing", sold out, or the lease
 * got a public rent) is deleted. A read that may have missed some of the
 * website's plans (`complete` false) cannot say a price is gone, so such a
 * row is only detached from the website instead (see unconfirmHiddenRents).
 * Rows from the listing's other websites are left alone, and a failed save
 * changes nothing else. Returns the number saved.
 */
export async function replaceHiddenRents({ listingId, rows, sourceUrl = null, complete = true }) {
  const clean = (rows ?? []).filter((r) => r.leaseId && Number(r.rent) > 0 && Number(r.rent) < 100000);
  const saved = clean.length ? await saveHiddenRents({ listingId, rows: clean, sourceUrl }) : 0;
  if (!listingId || !sourceUrl || (clean.length && !saved)) return saved;
  const table = supabase.from("lease_hidden_rents");
  let q = (complete ? table.delete() : table.update({ source_url: null })).eq("listing_id", listingId).eq("source_url", sourceUrl);
  if (clean.length) q = q.not("lease_id", "in", `(${[...new Set(clean.map((r) => r.leaseId))].join(",")})`);
  const { error } = await q;
  if (error) console.error("[hiddenRents] prune failed:", error.message);
  return saved;
}

/*
 * A read held for churn (too much changed at once, the usual sign of a
 * misread) neither saves nor deletes: what that website showed before is no
 * longer confirmed, so its rows are detached from it (source_url cleared).
 * An unchanged page after that never refreshes them, and they age out after
 * HIDDEN_RENT_MAX_AGE_DAYS unless a good read saves them again.
 */
export async function unconfirmHiddenRents(listingId, sourceUrls) {
  const urls = [...new Set((sourceUrls ?? []).filter(Boolean))];
  if (!listingId || !urls.length) return;
  const { error } = await supabase.from("lease_hidden_rents").update({ source_url: null }).eq("listing_id", listingId).in("source_url", urls);
  if (error) console.error("[hiddenRents] unconfirm failed:", error.message);
}

/*
 * The sync read a website and it had not changed since the last read: the
 * prices it showed then are still showing, so the hidden copies taken from
 * THAT website are fresh. The last full read of it left only the rows it
 * saved under its URL (replaceHiddenRents, unconfirmHiddenRents), so only
 * those are refreshed. Copies from another of the listing's sources are left
 * to age out on their own.
 */
export async function touchHiddenRents(listingId, sourceUrls) {
  const urls = [...new Set((sourceUrls ?? []).filter(Boolean))];
  if (!listingId || !urls.length) return;
  const { error } = await supabase
    .from("lease_hidden_rents")
    .update({ seen_at: new Date().toISOString() })
    .eq("listing_id", listingId)
    .in("source_url", urls);
  if (error) console.error("[hiddenRents] touch failed:", error.message);
}

/*
 * Whether a listing has an unpriced live lease and no fresh hidden price:
 * then an unchanged page still needs one full pass to save them (the first
 * read after this feature shipped, after a held run saved none, or once the
 * ones it had have aged out).
 */
export async function hiddenRentsMissing(listingId) {
  if (!listingId) return false;
  const [{ count: blanks, error: e1 }, { count: rows, error: e2 }] = await Promise.all([
    supabase
      .from("unit_leases")
      .select("id, listing_units!inner(listing_id)", { count: "exact", head: true })
      .eq("listing_units.listing_id", listingId)
      .is("rent", null)
      .is("deleted_at", null)
      .eq("unavailable", false),
    supabase.from("lease_hidden_rents").select("lease_id", { count: "exact", head: true }).eq("listing_id", listingId).gte("seen_at", freshSince()),
  ]);
  if (e1 || e2) return false;
  return (blanks ?? 0) > 0 && (rows ?? 0) === 0;
}
