/*
 * Which of a landlord's properties their commission agreement covers, and what
 * they need to sign to cover more (decisions of 2026-11-04).
 *
 *   - One master agreement per landlord, with an Exhibit A listing the covered
 *     properties, signed once. It has no end date in the app.
 *   - A property added later is covered by an Exhibit A amendment, its own signed
 *     document each time (Wyatt 2026-11-06); the signed agreement is never changed.
 *   - Each property on Exhibit A is the whole building or named units (Wyatt,
 *     2026-11-07). The whole building covers every unit there, new ones too; named
 *     units cover only those. A property counts as covered when the whole building
 *     is, or every unit holding the landlord's leases is named; a lease on another
 *     unit needs an amendment adding it. A renamed unit counts as a new one.
 *   - Exhibit A holds everything the landlord has live, whatever they are
 *     publishing now, and their drafts unless they take a draft off (then
 *     publishing it later needs an amendment).
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
const COVERAGE_COLUMNS = "id, user_id, listing_id, address, units, whole_building, agreement_id, amendment_id, status, covered_at, released_at, created_at";
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
      const byName = (a, b) => a.localeCompare(b, "en", { numeric: true });
      // Every unit they can name on Exhibit A (the property's, or their own offerings').
      const unitList = [];
      for (const u of unitRows) {
        const label = unitLabel(u);
        if (label && !unitList.some((x) => x.label === label)) unitList.push({ id: u.id, label });
      }
      unitList.sort((a, b) => byName(a.label, b.label));
      const units = unitList.map((u) => u.label);
      // The units holding this landlord's own leases: what coverage must include.
      const leaseUnits = [...new Set(mine.map((m) => unitLabel(m.unit)).filter(Boolean))].sort(byName);
      const published = !!l.published_at;
      // Live for this landlord: the property is published and either it is theirs or
      // one of their own offerings on it is.
      const live = published && (propertyOwner || mine.some((m) => m.published));
      return { listingId: l.id, address: displayAddress(l), units, unitList, leaseUnits, owner: propertyOwner, live, draft: !published };
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
 * The pure rule: what is covered now. `master` is the landlord's current signed
 * master agreement and `masterValid` whether it still counts. Returns a Map
 * listingId -> the covering row (the newest), with `units` and `whole_building`
 * merged across every document covering that property (the agreement and its
 * amendments).
 */
export function coveredMap(rows, { master, masterValid }) {
  const out = new Map();
  if (!master || !masterValid) return out;
  for (const r of rows) {
    if (r.status !== "covered" || r.agreement_id !== master.id) continue;
    const prev = out.get(r.listing_id);
    const units = [...new Set([...(prev?.units ?? []), ...(Array.isArray(r.units) ? r.units : [])])];
    const whole = (prev?.whole_building ?? false) || r.whole_building !== false;
    out.set(r.listing_id, { ...(prev ?? r), units, whole_building: whole });
  }
  return out;
}

// Whether a property is covered: the whole building, or every unit with the landlord's leases.
export function coversProperty(p, row) {
  if (!row) return false;
  if (row.whole_building !== false) return true;
  return (p?.leaseUnits ?? []).every((u) => (row.units ?? []).includes(u));
}

// The units with the landlord's leases a covering row does not name.
export function missingUnits(p, row) {
  if (!row) return p?.leaseUnits ?? [];
  if (row.whole_building !== false) return [];
  return (p?.leaseUnits ?? []).filter((u) => !(row.units ?? []).includes(u));
}

/*
 * One property's Exhibit A choice, made safe: `s` is what the landlord picked on
 * the signing popup ({ include, wholeBuilding, units }) or null for the default.
 * Default: the whole building for a property they own, else the units with their
 * leases. Only an owner can choose the whole building. Units are names the
 * property has; units with their leases on a `locked` property (live, or being
 * published) are always in. A locked property is always included.
 */
export function exhibitChoice(p, s, { locked = false } = {}) {
  const canWhole = !!p.owner;
  // Anything the choice does not say keeps the default.
  const wholeBuilding = canWhole && (typeof s?.wholeBuilding === "boolean" ? s.wholeBuilding : true);
  const known = new Set(p.units ?? []);
  const picked = Array.isArray(s?.units) ? s.units.filter((u) => known.has(u)) : p.leaseUnits ?? [];
  const units = wholeBuilding ? [] : [...new Set([...picked, ...(locked ? p.leaseUnits ?? [] : [])])].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  return { include: locked || !s || s.include !== false, wholeBuilding, units };
}

const entryOf = (p, choice) => ({ listingId: p.listingId, address: p.address, wholeBuilding: choice.wholeBuilding, units: choice.units });
const entryFromRow = (r) => ({
  listingId: r.listing_id,
  address: r.address,
  wholeBuilding: r.whole_building !== false,
  units: r.whole_building !== false ? [] : Array.isArray(r.units) ? r.units : [],
});

/*
 * What the landlord needs to sign to cover `requestedIds` (the properties being
 * published; may be empty when they sign from the Payments tab):
 *
 *   { kind: "none" }                          everything needed is covered
 *   { kind: "master", entries }               no master that counts: sign one whose
 *                                             Exhibit A lists every live property,
 *                                             the requested ones, their drafts (unless
 *                                             taken off) and anything a lapsed master
 *                                             covered that is still theirs
 *   { kind: "amendment", previous, entries, added }
 *                                             a master counts: amend Exhibit A from
 *                                             `previous` (covered now) to `entries`
 *
 * Needed: every live property and the requested ones, fully covered. Drafts ride
 * along on any document being made, unless the landlord takes them off.
 * `selections` is a Map listingId -> the popup's choice (exhibitChoice). `carry`
 * are entries of a document in progress that is being replaced.
 * Entries are { listingId, address, wholeBuilding, units }.
 */
export function planCoverage({ properties, rows, master, masterValid, requestedIds = [], carry = [], selections = null }) {
  const byId = new Map(properties.map((p) => [p.listingId, p]));
  const requested = new Set(requestedIds.filter((id) => byId.has(id)));
  const covered = coveredMap(rows, { master, masterValid });
  // What must be covered (live, being published, already on a copy being replaced,
  // or covered by a master being re-signed), then the drafts that may ride along.
  // Nothing needed can be taken off; its units with the landlord's leases stay in.
  const needed = new Set([
    ...requested,
    ...properties.filter((p) => p.live).map((p) => p.listingId),
    ...carry.map((e) => e.listingId).filter((id) => byId.has(id)),
  ]);
  const choiceFor = (p) => exhibitChoice(p, selections?.get(p.listingId) ?? null, { locked: needed.has(p.listingId) });
  const drafts = properties.filter((p) => p.draft && !needed.has(p.listingId)).map((p) => p.listingId);

  if (!master || !masterValid) {
    // A lapsed or re-sign-required master: what it covered carries into the new one.
    for (const r of rows) if (r.status === "covered" && master && r.agreement_id === master.id && byId.has(r.listing_id)) needed.add(r.listing_id);
    const entries = [...needed, ...drafts]
      .map((id) => [byId.get(id), choiceFor(byId.get(id))])
      .filter(([, c]) => c.include)
      .map(([p, c]) => entryOf(p, c))
      .sort(byAddress);
    return { kind: "master", entries };
  }

  // Something needed is not fully covered: an amendment (else nothing to sign).
  const short = [...needed].filter((id) => !coversProperty(byId.get(id), covered.get(id)));
  if (!short.length) return { kind: "none" };
  const added = [];
  for (const id of [...needed, ...drafts]) {
    const p = byId.get(id);
    const c = choiceFor(p);
    if (!c.include) continue;
    const cov = covered.get(id);
    const adds = !cov || (c.wholeBuilding && cov.whole_building === false) || (!c.wholeBuilding && cov.whole_building === false && c.units.some((u) => !cov.units.includes(u)));
    if (!adds) continue;
    // Merged with what is covered there already, so the "after" list is the whole picture.
    added.push(cov && !c.wholeBuilding ? { ...entryOf(p, c), units: [...new Set([...cov.units, ...c.units])].sort((a, b) => a.localeCompare(b, "en", { numeric: true })) } : entryOf(p, c));
  }
  const previous = [...covered.values()].map(entryFromRow).sort(byAddress);
  const addedIds = new Set(added.map((e) => e.listingId));
  const entries = [...previous.filter((e) => !addedIds.has(e.listingId)), ...added].sort(byAddress);
  return { kind: "amendment", previous, entries, added: added.sort(byAddress) };
}

// Requested properties that are not fully covered now, with their addresses (and the units missing) for the publish dialog.
export function uncoveredAmong(properties, coverage, listingIds) {
  const byId = new Map(properties.map((p) => [p.listingId, p]));
  return [...new Set(listingIds)]
    .filter((id) => !coversProperty(byId.get(id), coverage.get(id)))
    .map((id) => ({
      listingId: id,
      address: byId.get(id)?.address ?? "New property",
      ...(coverage.has(id) && { missingUnits: missingUnits(byId.get(id), coverage.get(id)) }),
    }));
}
