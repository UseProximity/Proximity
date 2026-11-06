/*
 * Which of a landlord's properties their commission agreement covers, and what
 * they need to sign to cover more (decisions of 2026-11-04).
 *
 *   - One master agreement per landlord, with an Exhibit A listing the covered
 *     properties, signed once. Its term runs to the next September 15 and renews
 *     by itself every year.
 *   - A property added later is covered by an Exhibit A amendment, its own signed
 *     document each time (the amendment template plus Exhibit A before and after,
 *     Wyatt 2026-11-06); the signed agreement is never changed. Coverage is per
 *     property (address): a new unit
 *     or lease at a covered address needs nothing.
 *   - Exhibit A holds everything the landlord has live plus whatever they are
 *     publishing now. Drafts join when they are published.
 *   - A property is covered only once the document adding it is signed (the
 *     database refuses anything else, 202611050001), and only while the master it
 *     belongs to is signed, still counts and is inside its term.
 *
 * "A landlord's properties" are the listings they own (listing_landlords) or have
 * an offering on (unit_leases.owner_id): each landlord covers their own offerings,
 * so two landlords letting units in one building each list it.
 *
 * `db` is a service-role Supabase client.
 */
const COVERAGE_COLUMNS = "id, user_id, listing_id, address, units, agreement_id, amendment_id, status, covered_at, released_at, created_at";
const missingSchema = (error) => ["PGRST205", "42P01", "42703", "PGRST200"].includes(error?.code);

// "6105 Delmar Boulevard, St. Louis, Missouri 63112": the stored address without the country.
export function displayAddress(listing) {
  const base = String(listing?.address ?? "").replace(/,\s*(United States|USA|US)\s*$/i, "").trim();
  if (base) return base;
  return [listing?.city, [listing?.state, listing?.zipcode].filter(Boolean).join(" ")].filter(Boolean).join(", ") || "Address not given";
}

export function unitLabel(unit) {
  const numbered = [unit?.unit_designator, unit?.unit_number].filter(Boolean).join(" ");
  return String(unit?.name || numbered || unit?.title || "").trim() || null;
}

const byAddress = (a, b) => a.address.localeCompare(b.address, "en", { numeric: true });

// Supabase answers at most 1,000 rows a request; a large landlord has more leases than that.
const PAGE = 1000;
async function allRows(build) {
  const out = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) return out;
  }
}

/*
 * Every property the landlord has a stake in, with its units: { listingId, address,
 * units, live, draft }. `live` means students can see it now. Review sandbox
 * listings are left out (they never reach real students).
 */
export async function loadLandlordProperties(db, userId) {
  const [owned, leases] = await Promise.all([
    allRows(() => db.from("listing_landlords").select("listing_id").eq("user_id", userId).order("listing_id")),
    allRows(() =>
      db
        .from("unit_leases")
        .select("id, published_at, deleted_at, listing_units!unit_id(id, listing_id, name, unit_number, unit_designator, title, published_at, deleted_at)")
        .eq("owner_id", userId)
        .is("deleted_at", null)
        .order("id")
    ),
  ]);

  const ownedIds = new Set(owned.map((r) => r.listing_id).filter(Boolean));
  const myUnits = new Map(); // listingId -> Map(unitId -> { unit, published })
  for (const lease of leases) {
    const unit = lease.listing_units;
    if (!unit?.listing_id || unit.deleted_at) continue;
    const units = myUnits.get(unit.listing_id) ?? new Map();
    const prev = units.get(unit.id);
    units.set(unit.id, { unit, published: !!prev?.published || (!!lease.published_at && !!unit.published_at) });
    myUnits.set(unit.listing_id, units);
  }
  const ids = [...new Set([...ownedIds, ...myUnits.keys()])];
  if (!ids.length) return [];

  const [listings, ownedUnits] = await Promise.all([
    allRows(() => db.from("listings").select("id, address, city, state, zipcode, published_at, deleted_at, review_sandbox").in("id", ids).order("id")),
    ownedIds.size
      ? allRows(() =>
          db
            .from("listing_units")
            .select("id, listing_id, name, unit_number, unit_designator, title, published_at, deleted_at")
            .in("listing_id", [...ownedIds])
            .is("deleted_at", null)
            .order("id")
        )
      : Promise.resolve([]),
  ]);

  const unitsByListing = new Map();
  for (const u of ownedUnits) {
    const list = unitsByListing.get(u.listing_id) ?? [];
    list.push(u);
    unitsByListing.set(u.listing_id, list);
  }

  return listings
    .filter((l) => !l.deleted_at && l.review_sandbox !== true)
    .map((l) => {
      const mine = [...(myUnits.get(l.id)?.values() ?? [])];
      const propertyOwner = ownedIds.has(l.id);
      const unitRows = propertyOwner ? unitsByListing.get(l.id) ?? [] : mine.map((m) => m.unit);
      const units = [...new Set(unitRows.map(unitLabel).filter(Boolean))].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
      const published = !!l.published_at;
      // Live for this landlord: the property is published and either it is theirs or
      // one of their own offerings on it is.
      const live = published && (propertyOwner || mine.some((m) => m.published));
      return { listingId: l.id, address: displayAddress(l), units, live, draft: !published };
    })
    .sort(byAddress);
}

/*
 * A draft that is an edit of a live property is merged into it when published
 * (api/landlord/publish), so it is the live property that needs covering. Maps
 * each id to the id that will be live: its live twin, or itself.
 */
export async function resolvePublishedIds(db, listingIds) {
  const ids = [...new Set((listingIds ?? []).filter(Boolean))];
  if (!ids.length) return [];
  const { data, error } = await db.from("listings").select("id, property_key, published_at, review_sandbox").in("id", ids);
  if (error) throw error;
  const out = new Set();
  for (const l of data ?? []) {
    if (l.published_at || !l.property_key) {
      out.add(l.id);
      continue;
    }
    const { data: twins, error: twinError } = await db
      .from("listings")
      .select("id, review_sandbox")
      .eq("property_key", l.property_key)
      .neq("id", l.id)
      .is("deleted_at", null)
      .not("published_at", "is", null)
      .order("created_at", { ascending: true })
      .limit(20);
    if (twinError) throw twinError;
    const twin = (twins ?? []).find((t) => (t.review_sandbox === true) === (l.review_sandbox === true));
    out.add(twin?.id ?? l.id);
  }
  return [...out];
}

// The landlord's coverage rows that are not released, newest first.
export async function loadCoverageRows(db, userId) {
  const { data, error } = await db
    .from("agreement_coverage")
    .select(COVERAGE_COLUMNS)
    .eq("user_id", userId)
    .in("status", ["proposed", "covered"])
    .order("created_at", { ascending: false });
  if (missingSchema(error)) return [];
  if (error) throw error;
  return data ?? [];
}

/*
 * The pure rule: which properties count as covered now. `master` is the
 * landlord's current signed master agreement and `masterValid` whether it still
 * counts (agreementState: version not superseded by a re-sign, term not over).
 * Returns a Map listingId -> the covering row.
 */
export function coveredMap(rows, { master, masterValid }) {
  const out = new Map();
  if (!master || !masterValid) return out;
  for (const r of rows) {
    if (r.status === "covered" && r.agreement_id === master.id && !out.has(r.listing_id)) out.set(r.listing_id, r);
  }
  return out;
}

const entryOf = (p) => ({ listingId: p.listingId, address: p.address, units: p.units ?? [] });
const entryFromRow = (r) => ({ listingId: r.listing_id, address: r.address, units: Array.isArray(r.units) ? r.units : [] });

/*
 * What the landlord needs to sign to cover `requestedIds` (the properties being
 * published; may be empty when they sign from the Payments tab):
 *
 *   { kind: "none" }                          everything asked for is covered
 *   { kind: "master", entries }               no master that counts: sign one whose
 *                                             Exhibit A lists every live property,
 *                                             the requested ones, and anything a
 *                                             lapsed master covered that is still theirs
 *   { kind: "amendment", previous, entries, added }
 *                                             a master counts: amend Exhibit A from
 *                                             `previous` (covered now) to `entries`
 *
 * `carry` are entries of a document in progress that is being replaced, so a new
 * copy never drops a property the landlord already asked to add.
 */
export function planCoverage({ properties, rows, master, masterValid, requestedIds = [], carry = [] }) {
  const byId = new Map(properties.map((p) => [p.listingId, p]));
  const requested = requestedIds.filter((id) => byId.has(id));
  const covered = coveredMap(rows, { master, masterValid });

  const want = new Map();
  const add = (e) => {
    if (e && byId.has(e.listingId) && !want.has(e.listingId)) want.set(e.listingId, entryOf(byId.get(e.listingId)));
  };
  properties.filter((p) => p.live).forEach(add);
  requested.forEach((id) => add(byId.get(id)));
  carry.forEach(add);

  if (!master || !masterValid) {
    // A lapsed or re-sign-required master: what it covered carries into the new one.
    rows.filter((r) => r.status === "covered" && master && r.agreement_id === master.id).forEach((r) => add({ listingId: r.listing_id }));
    const entries = [...want.values()].sort(byAddress);
    if (!entries.length) return { kind: "master", entries: [] };
    return { kind: "master", entries };
  }

  const added = [...want.values()].filter((e) => !covered.has(e.listingId));
  if (!added.length) return { kind: "none" };
  const previous = [...covered.values()].map(entryFromRow).sort(byAddress);
  const entries = [...previous, ...added].sort(byAddress);
  return { kind: "amendment", previous, entries, added: added.sort(byAddress) };
}

// Requested properties that are not covered now, with their addresses for the publish dialog.
export function uncoveredAmong(properties, coverage, listingIds) {
  const byId = new Map(properties.map((p) => [p.listingId, p]));
  return [...new Set(listingIds)]
    .filter((id) => !coverage.has(id))
    .map((id) => ({ listingId: id, address: byId.get(id)?.address ?? "New property" }));
}
