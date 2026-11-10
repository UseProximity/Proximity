import defaultClient from "@/lib/supabase";

/*
 * Which listing a review belongs on.
 *
 * A review names an address, and the listing at that address is where it must
 * land. When this misses, the review flow makes a new "stub" property beside
 * the real one and the review sits where no student looks.
 *
 * It used to miss in two ways. It read at most 100 listings from a box a
 * kilometre wide and compared street lines among those, and near campus that
 * box holds more than 100, so the real listing could simply not be among the
 * rows read (723 Interdrive, November 2026). And it compared the whole street
 * line, so a listing stored as "6629 Kingsbury Blvd APT 2W" never equalled
 * "6629 Kingsbury Boulevard".
 *
 * Both sides are now compared by property_key, the key the database stores on
 * every listing and the rest of the app already uses to decide "same address"
 * (normalize_property_key: unit designators and the street type are dropped).
 * Candidates are read by that key, so nothing depends on how many listings are
 * nearby. The key leaves directionals as typed ("25 n central" beside
 * "25 north central"), so the street is canonicalised here before comparing,
 * and a small box around the point catches a row whose key was spelled the
 * other way.
 */

// Canonical forms for common street-type suffixes and directionals.
const STREET_TOKEN_SYNONYMS = {
  ave: "avenue", av: "avenue", avenu: "avenue",
  st: "street", str: "street",
  rd: "road",
  dr: "drive", drv: "drive",
  blvd: "boulevard", blv: "boulevard",
  ln: "lane",
  ct: "court", crt: "court",
  pl: "place",
  ter: "terrace", terr: "terrace",
  cir: "circle",
  pkwy: "parkway", pky: "parkway",
  hwy: "highway",
  sq: "square",
  trl: "trail",
  pt: "point",
  n: "north", s: "south", e: "east", w: "west",
  ne: "northeast", nw: "northwest", se: "southeast", sw: "southwest",
};

const streetOf = (key) => String(key || "").split("|")[0];
const zipOf = (key) => String(key || "").split("|")[1] || "";

export function canonStreet(street) {
  return String(street || "")
    .split(" ")
    .filter(Boolean)
    .map((tok) => STREET_TOKEN_SYNONYMS[tok] || tok)
    .join(" ");
}

export function metersBetween(aLat, aLng, bLat, bLng) {
  const dLat = (aLat - bLat) * 111320;
  const dLng = (aLng - bLng) * 111320 * Math.cos((aLat * Math.PI) / 180);
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

/*
 * The same street line in another ZIP is the same building only when it is
 * also in the same spot: two sources can disagree about the ZIP along a
 * boundary, while "100 Main" in two towns is two buildings.
 */
const SAME_SPOT_METERS = 300;
// About 330 m each way: wide enough for two geocoders' idea of one building.
const LAT_PAD = 0.003;
const LNG_PAD = 0.004;

const COLUMNS = "id, property_key, latitude, longitude, lease_type, created_at, published_at";

/*
 * Returns { listingId } (null when nothing matches) or { error } when the
 * address could not be read. A failed read must stop the review rather than
 * fall through to "no match", which is exactly how a duplicate gets made.
 */
export async function findListingForReviewAddress({ address, lat, lng, supabase = defaultClient }) {
  const { data: key, error: keyError } = await supabase.rpc("normalize_property_key", { p_address: address });
  if (keyError) return { error: keyError.message };
  const street = streetOf(key);
  if (!street || lat == null || lng == null) return { listingId: null };
  const target = canonStreet(street);
  const zip = zipOf(key);

  // A review sandbox listing is hidden, so a real review must not be filed on it.
  const live = () => supabase.from("listings").select(COLUMNS).is("deleted_at", null).eq("review_sandbox", false);
  const [byKey, nearby] = await Promise.all([
    // The key's street holds only letters, digits and spaces, so it is safe in a pattern.
    live().like("property_key", `${street}|%`).order("created_at", { ascending: true }).limit(200),
    live()
      .gte("latitude", lat - LAT_PAD)
      .lte("latitude", lat + LAT_PAD)
      .gte("longitude", lng - LNG_PAD)
      .lte("longitude", lng + LNG_PAD)
      .order("created_at", { ascending: true })
      .limit(1000),
  ]);
  if (byKey.error || nearby.error) return { error: (byKey.error || nearby.error).message };

  const seen = new Map();
  for (const row of [...(byKey.data ?? []), ...(nearby.data ?? [])]) seen.set(row.id, row);

  const matches = [...seen.values()].filter((row) => {
    if (canonStreet(streetOf(row.property_key)) !== target) return false;
    const rowZip = zipOf(row.property_key);
    if (!zip || !rowZip || zip === rowZip) return true;
    if (row.latitude == null || row.longitude == null) return false;
    return metersBetween(lat, lng, Number(row.latitude), Number(row.longitude)) <= SAME_SPOT_METERS;
  });
  if (matches.length === 0) return { listingId: null };
  if (matches.length === 1) return { listingId: matches[0].id };

  const { data: lls } = await supabase
    .from("listing_landlords")
    .select("listing_id, owner:users!user_id(roles!role_id(name))")
    .in("listing_id", matches.map((l) => l.id));
  const landlordOwned = new Set(
    (lls ?? []).filter((ll) => ll.owner?.roles?.name === "landlord").map((ll) => ll.listing_id)
  );

  /*
   * Several listings at one address. A live one before a draft (students can
   * see it), then a standard listing before a sublease, then one a landlord
   * owns, then the oldest.
   */
  const isSublease = (l) => (l.lease_type || "").toLowerCase() === "sublease";
  matches.sort((a, b) => {
    if (!!a.published_at !== !!b.published_at) return a.published_at ? -1 : 1;
    if (isSublease(a) !== isSublease(b)) return isSublease(a) ? 1 : -1;
    if (landlordOwned.has(a.id) !== landlordOwned.has(b.id)) return landlordOwned.has(a.id) ? -1 : 1;
    return new Date(a.created_at) - new Date(b.created_at);
  });
  return { listingId: matches[0].id };
}
