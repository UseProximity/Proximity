/*
 * Per-listing commute minutes for Find Your Place, one number per mode:
 *
 *   walk     shortest walk to a main-campus building   (listing_walk_times)
 *   bike     bike ride to the Danforth University Center (listing_bike_times)
 *   shuttle  walk to the nearest shuttle STOP            (listing_walk_times)
 *   car      drive to the nearest campus garage          (listing_drive_times)
 *
 * null always means "not on file". Nothing here guesses a time.
 */
import supabase from "@/lib/supabase";
import { fetchBikeMinutes } from "@/utils/bikeTimes";
import { NON_CAMPUS_WALK_PLACES } from "@/utils/washuPlaces";

// Where a student who drives actually ends up.
const CAMPUS_GARAGES = ["East End Garage", "Millbrook Garage", "WC Lower Lot"];

// How many missing bike times one matching request may fill. A new listing gets
// its time the first time someone's search could use it; the rest of the field
// is filled by the admin backfill, so this only ever catches stragglers.
const BIKE_FILL_PER_REQUEST = 12;

const minOrNull = (arr) => (arr.length ? Math.min(...arr) : null);

// Walk and shuttle come from the rows fetchActiveListings already loaded.
function walkTimesOf(listing) {
  const campus = [];
  const shuttle = [];
  for (const w of listing.listing_walk_times ?? []) {
    const name = w.locations?.name ?? "";
    if (!Number.isFinite(w.minutes)) continue;
    if (name === "shuttle_nearest") shuttle.push(w.minutes);
    else if (!NON_CAMPUS_WALK_PLACES.includes(name)) campus.push(w.minutes);
  }
  return { walk: minOrNull(campus), shuttle: minOrNull(shuttle) };
}

async function driveTimesFor(ids) {
  const out = {};
  if (!ids.length) return out;
  const { data, error } = await supabase
    .from("listing_drive_times")
    .select("listing_id, minutes, locations!inner(name)")
    .in("listing_id", ids)
    .in("locations.name", CAMPUS_GARAGES);
  if (error) {
    console.error("[findYourPlace] drive times read failed:", error.message);
    return out;
  }
  for (const row of data ?? []) {
    if (!Number.isFinite(row.minutes)) continue;
    out[row.listing_id] = Math.min(out[row.listing_id] ?? Infinity, row.minutes);
  }
  return out;
}

/*
 * A listing whose Mapbox call just failed (timeout, rate limit) is left alone
 * for a while on this server instance, so a run of failures does not cost
 * every bike search the same slow calls. In memory, like the IP limits: it
 * only spaces the retries out.
 */
const FAILED_RETRY_MS = 60 * 60 * 1000;
// A stored "no route" is checked again after this long (Mapbox's map changes).
const NO_ROUTE_RETRY_MS = 30 * 24 * 60 * 60 * 1000;

function failedRecently() {
  if (!globalThis.__prxBikeFailed) globalThis.__prxBikeFailed = new Map();
  const map = globalThis.__prxBikeFailed;
  const now = Date.now();
  for (const [id, at] of map) if (now - at > FAILED_RETRY_MS) map.delete(id);
  return map;
}

/*
 * Compute and store bike times. A ride time is stored as minutes; "Mapbox has
 * no route" is stored as NULL so the listing counts as checked. A failed call
 * stores nothing and is retried later. `db` lets the admin backfill write to
 * the database it was pointed at. Returns { [listingId]: minutes } for the
 * listings that got a ride time.
 */
export async function fillBikeTimes(listings, { db = supabase } = {}) {
  const failed = failedRecently();
  const results = {};
  await Promise.all(
    listings.map(async (l) => {
      const lat = Number(l.latitude);
      const lng = Number(l.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
      try {
        results[l.id] = await fetchBikeMinutes(lat, lng);
      } catch (err) {
        failed.set(l.id, Date.now());
        console.error("[findYourPlace] bike time fetch failed:", err?.message);
      }
    })
  );
  const now = new Date().toISOString();
  const rows = Object.entries(results).map(([listing_id, minutes]) => ({ listing_id, minutes, updated_at: now }));
  if (rows.length) {
    const { error } = await db.from("listing_bike_times").upsert(rows, { onConflict: "listing_id" });
    if (error) console.error("[findYourPlace] bike time save failed:", error.message);
  }
  return Object.fromEntries(Object.entries(results).filter(([, m]) => m != null));
}

async function bikeTimesFor(listings) {
  const out = {};
  const ids = listings.map((l) => l.id);
  if (!ids.length) return out;
  const { data, error } = await supabase.from("listing_bike_times").select("listing_id, minutes, updated_at").in("listing_id", ids);
  if (error) {
    // Before the migration lands on an environment the table is absent: bike
    // times are simply unknown there.
    console.error("[findYourPlace] bike times read failed:", error.message);
    return out;
  }
  // Checked = a ride time on file, or a recent "no route". Only the rest are
  // worth a Mapbox call, so the fill budget goes to real gaps.
  const checked = new Set();
  const now = Date.now();
  for (const row of data ?? []) {
    if (row.minutes != null) out[row.listing_id] = row.minutes;
    if (row.minutes != null || now - new Date(row.updated_at).getTime() < NO_ROUTE_RETRY_MS) checked.add(row.listing_id);
  }
  const failed = failedRecently();
  const missing = listings.filter((l) => !checked.has(l.id) && !failed.has(l.id)).slice(0, BIKE_FILL_PER_REQUEST);
  if (missing.length) Object.assign(out, await fillBikeTimes(missing));
  return out;
}

// { [listingId]: { walk, bike, shuttle, car } } for the given listing rows.
// `modes` limits the extra reads to the ones the student picked.
export async function commuteTimesFor(listings, modes = []) {
  const ids = listings.map((l) => l.id);
  const [drive, bike] = await Promise.all([
    modes.includes("car") ? driveTimesFor(ids) : {},
    modes.includes("bike") ? bikeTimesFor(listings) : {},
  ]);
  const out = {};
  for (const l of listings) {
    const { walk, shuttle } = walkTimesOf(l);
    out[l.id] = { walk, shuttle, bike: bike[l.id] ?? null, car: drive[l.id] ?? null };
  }
  return out;
}
