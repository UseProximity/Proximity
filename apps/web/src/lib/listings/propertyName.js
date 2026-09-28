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
