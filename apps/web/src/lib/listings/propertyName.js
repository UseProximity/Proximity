import supabase from "@/lib/supabase";

/*
 * Display-name uniqueness for properties.
 *
 * One name per school (migration 202608310001). The unique index is the thing
 * that makes the rule true; this module exists so a landlord hits a sentence
 * instead of a Postgres error, and so every write path phrases it the same way.
 *
 * The normalizer is NOT reimplemented here. It lives in the database as
 * normalize_property_name() and is called over RPC, for the same reason
 * normalize_property_key() is: a second copy in JavaScript drifts, and the way
 * it fails is a name the API cheerfully accepts and the index then rejects with
 * a 500 the landlord cannot act on.
 */

// Shown on the name field. Kept here so the API and both forms agree.
export const PROPERTY_NAME_TAKEN = "This property name is taken";

// The bucket unschooled listings share. Must match the coalesce in the index —
// api/addListing does not set school_id, so this is the common case, not an edge.
const NO_SCHOOL = "00000000-0000-0000-0000-000000000000";

/**
 * The conflicting property, or null if the name is free.
 *
 * `excludeListingId` keeps a listing from colliding with itself when a landlord
 * saves an edit without touching the name — the overwhelmingly common PATCH.
 *
 * A lookup that errors returns null: the index still refuses a genuine duplicate,
 * so degrading to "let it through and let the database decide" is safe, where
 * degrading to "block the save" would strand a landlord over an unrelated outage.
 */
export async function findPropertyNameConflict(
  title,
  { schoolId = null, excludeListingId = null } = {}
) {
  const { data: normalized, error: rpcError } = await supabase.rpc(
    "normalize_property_name",
    { p_title: title ?? null }
  );

  // Unnamed properties are exempt — the index skips them too.
  if (rpcError || !normalized) {
    if (rpcError) {
      console.error("[propertyName] normalize failed:", rpcError.message);
    }
    return null;
  }

  let query = supabase
    .from("listings")
    .select("id, title, address, school_id")
    .is("deleted_at", null);

  query = schoolId ? query.eq("school_id", schoolId) : query.is("school_id", null);
  if (excludeListingId) query = query.neq("id", excludeListingId);

  const { data: rows, error } = await query;
  if (error) {
    console.error("[propertyName] conflict lookup failed:", error.message);
    return null;
  }

  /*
   * The comparison is finished in JS rather than as a `.eq()` on the normalized
   * expression because PostgREST cannot filter on a computed one. The candidate
   * set is a single school's listings, so this stays small — and it is compared
   * with the same normalized values the database produced, one RPC round trip
   * for the incoming name and the stored ones re-derived below.
   */
  const wanted = String(normalized);
  for (const row of rows ?? []) {
    const rowNorm = normalizeLocally(row.title);
    if (rowNorm && rowNorm === wanted) return row;
  }
  return null;
}

/*
 * Which of these properties are already on Proximity, as one query.
 *
 * For the importer's property picker. A company adding the rest of its
 * portfolio has usually listed some of it already — Keeley has four of theirs —
 * and without this the landlord finds out by filling in a whole building and
 * being told at the last step that the name is taken.
 *
 * Matched on the name OR the address, because the two rarely agree. Keeley's
 * site says "Echo STL" and the listing says "Echo Apartments"; the same
 * building's address is written "625 N. Euclid Ave" on one side and "625 North
 * Euclid Avenue, St. Louis, Missouri 63108, United States" on the other. So the
 * address is reduced to the three things that survive being rewritten: the
 * street number, the postcode, and the name of the street with its Avenue or
 * Boulevard removed. 625 + 63108 + euclid, either way round.
 *
 * Every school is searched, not just the unschooled bucket the write path looks
 * at: this decides what the picker SAYS, and a listing that already exists is
 * already there whichever school it belongs to.
 */
const STREET_TYPES = new Set([
  "ave", "avenue", "st", "street", "rd", "road", "dr", "drive", "blvd",
  "boulevard", "ln", "lane", "ct", "court", "pl", "place", "way", "ter",
  "terrace", "cir", "circle", "pkwy", "parkway", "hwy", "highway", "sq",
  "square", "n", "s", "e", "w", "ne", "nw", "se", "sw", "north", "south",
  "east", "west", "apt", "unit", "suite", "ste", "united", "states", "usa",
]);

/*
 * A key two spellings of the same address agree on, or null when the address is
 * too vague to be sure. Deliberately conservative: a false match greys out a
 * building the landlord is entitled to add, which is worse than missing one and
 * letting the write refuse it.
 */
export function addressFingerprint(address) {
  const text = String(address ?? "").toLowerCase();
  const number = text.match(/\b(\d{1,6})\b/)?.[1];
  const zip = text.match(/\b(\d{5})(?:-\d{4})?\b/g)?.pop()?.slice(0, 5);
  if (!number || !zip || number === zip) return null;
  const street = text
    .split(",")[0]
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !/^\d+$/.test(w) && !STREET_TYPES.has(w))
    .sort((a, b) => b.length - a.length)[0];
  return street ? `${number}|${zip}|${street}` : null;
}

export async function findExistingProperties(entries) {
  const byName = new Map();
  const byAddress = new Map();
  for (const e of entries ?? []) {
    const n = normalizeLocally(e?.name);
    if (n) byName.set(n, null);
    const a = addressFingerprint(e?.address);
    if (a) byAddress.set(a, null);
  }
  if (!byName.size && !byAddress.size) return new Map();

  const { data: rows, error } = await supabase
    .from("listings")
    .select("id, title, address")
    .is("deleted_at", null);
  if (error) {
    console.error("[propertyName] existing lookup failed:", error.message);
    return new Map();
  }
  for (const row of rows ?? []) {
    const n = normalizeLocally(row.title);
    if (n && byName.has(n) && !byName.get(n)) byName.set(n, row);
    const a = addressFingerprint(row.address);
    if (a && byAddress.has(a) && !byAddress.get(a)) byAddress.set(a, row);
  }

  // Back to the caller's own entries, so it never has to normalize anything.
  const found = new Map();
  for (const e of entries ?? []) {
    const hit =
      byName.get(normalizeLocally(e?.name) ?? "") ??
      byAddress.get(addressFingerprint(e?.address) ?? "") ??
      null;
    if (hit) found.set(e, hit);
  }
  return found;
}

/*
 * A local mirror of normalize_property_name, used ONLY to compare rows already
 * fetched — never to decide what gets written. Keeping the authoritative copy in
 * SQL means the worst a drift here can do is miss a conflict the index still
 * catches, rather than admit one it will reject.
 */
function normalizeLocally(title) {
  if (title == null) return null;
  const out = String(title).toLowerCase().replace(/\s+/g, " ").trim();
  return out === "" ? null : out;
}

// Every write path answers a taken name the same way, so the forms can key off
// `field` instead of string-matching the message.
export function propertyNameTakenResponse(conflict) {
  return {
    error: PROPERTY_NAME_TAKEN,
    field: "title",
    conflict: conflict ? { address: conflict.address ?? null } : null,
  };
}

export { NO_SCHOOL };
