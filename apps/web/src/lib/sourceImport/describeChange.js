/*
 * A website change, side by side (Wyatt, 2026-11-05): for every change a
 * sync proposed (listing_source_events), what Proximity shows right now next
 * to what the website says, in plain words, for the landlord's import tab,
 * the landlord's Agent tab and the admin review queue.
 *
 * "Now" is read live from the unit, lease or listing, not from the copy the
 * sync kept, so a value the landlord changed since still shows correctly. The
 * copy is the fallback when the row is gone. Units are named as Proximity
 * names them, not by the website's internal codes ("melr-2ba",
 * {"name":"Cove" ...}).
 *
 *   describeChanges(events) -> Map(event id -> {
 *     title, unit, note, rows: [{ label, current, proposed }]
 *   })
 */
import supabase from "@/lib/supabase";

const NOT_ON_PROXIMITY = "Not on Proximity";
const NOT_GIVEN = "Not given";

const money = (n, perPerson = false) =>
  n == null || Number(n) === 0 ? "No price" : `$${Number(n).toLocaleString("en-US")}/mo${perPerson ? " per person" : ""}`;

function dateText(d) {
  if (!d) return null;
  const t = new Date(`${String(d).slice(0, 10)}T12:00:00Z`);
  return Number.isNaN(t.getTime()) ? String(d) : t.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function termsText(list) {
  const t = [...new Set((list ?? []).map(Number).filter((n) => n > 0))].sort((a, b) => a - b);
  if (!t.length) return null;
  if (t.length === 1) return `${t[0]} month${t[0] === 1 ? "" : "s"}`;
  const contiguous = t.every((n, i) => i === 0 || n === t[i - 1] + 1);
  return contiguous ? `${t[0]} to ${t[t.length - 1]} months` : `${t.join(", ")} months`;
}

const layout = (u) => {
  if (!u) return null;
  const beds = u.bedrooms == null ? "?" : Number(u.bedrooms) === 0 ? "Studio" : `${u.bedrooms} bed`;
  return Number(u.bedrooms) === 0 ? `Studio / ${u.bathrooms ?? "?"} bath` : `${beds} / ${u.bathrooms ?? "?"} bath`;
};
const sqft = (n) => (n == null ? null : `${Number(n).toLocaleString("en-US")} sq ft`);

/* The website's label, made readable: a JSON blob gives its name; a short code stays as is. */
function cleanLabel(label) {
  if (!label) return null;
  const s = String(label);
  const m = s.match(/"name"\s*:\s*"([^"]+)"/);
  return m ? m[1] : s;
}

function unitName(unit, fallbackLabel) {
  if (unit) return unit.name ? `${unit.name} (${layout(unit)})` : layout(unit);
  return cleanLabel(fallbackLabel);
}

const val = (v, fallback = NOT_GIVEN) => (v == null || v === "" ? fallback : v);
const row = (label, current, proposed) => ({ label, current: val(current), proposed: val(proposed) });

const SPEC_LABEL = { bedrooms: "Bedrooms", bathrooms: "Bathrooms", area: "Size", name: "Name" };
const specText = (f, v) => (v == null ? null : f === "area" ? sqft(v) : f === "name" ? cleanLabel(v) : String(v));

const PROPERTY_LABEL = {
  title: "Name", description: "Description", furnished: "Furnished", address: "Address",
  contact_name: "Contact name", contact_email: "Contact email", contact_phone: "Contact phone",
};
/* Websites repeat a special with small differences ("$$2,000" and "$2,000"): keep one of each. */
function uniqueSpecials(list) {
  const seen = new Set();
  return (list ?? []).map((x) => String(x).replace(/\$+/g, "$").trim()).filter((x) => {
    const k = x.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

const short = (s, n = 160) => (s == null ? null : String(s).length > n ? `${String(s).slice(0, n).trim()}…` : String(s));

/* The lease rows shared by new, changed and returning leases. */
function leaseRows(fields, live, from) {
  const out = [];
  for (const f of fields) {
    if (f === "rent") out.push(row("Rent", live ? money(live.rent, live.rent_is_per_person) : NOT_ON_PROXIMITY, from.rent === undefined ? null : money(from.rent, from.rentIsPerPerson ?? from.rent_is_per_person ?? live?.rent_is_per_person)));
    if (f === "leaseTermMonths") out.push(row("Lease length", live ? termsText(live.lease_term_months) : NOT_ON_PROXIMITY, termsText(from.leaseTermMonths ?? from.lease_term_months)));
    if (f === "availableFrom") out.push(row("Move-in date", live ? dateText(live.available_from) ?? "No date set" : NOT_ON_PROXIMITY, dateText(from.availableFrom ?? from.available_from) ?? "No date (available now)"));
    if (f === "apartments") out.push(row("Lease notes", live ? short(live.description) ?? "None" : NOT_ON_PROXIMITY, short(from.apartments ?? from.description)));
  }
  return out;
}

const CHUNK = 150;

// Every row of `build(ids)` over `ids` in chunks of CHUNK; throws on a failed read.
async function readIn(ids, build) {
  const out = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await build(ids.slice(i, i + CHUNK));
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
  }
  return out;
}

/*
 * Each event's "Proximity now vs the website" view, by event id. If the current
 * values cannot be read, no views at all (logged): the screens then show the
 * change without a comparison, never one built on missing data.
 */
export async function describeChanges(events, db = supabase) {
  try {
    return await buildViews(events, db);
  } catch (err) {
    console.error("describeChanges: could not read current values", err?.message ?? err);
    return new Map();
  }
}

async function buildViews(events, db) {
  const list = (events ?? []).filter(Boolean);
  const unitIds = [...new Set(list.map((e) => e.detail?.unitId).filter(Boolean))];
  const leaseIds = [...new Set(list.map((e) => e.detail?.leaseId).filter(Boolean))];
  const listingIds = [...new Set(list.filter((e) => e.kind === "property_updated" || e.kind === "photos_added").map((e) => e.listing_id).filter(Boolean))];

  // Ids go in chunks: hundreds of UUIDs in one .in() filter overflow the request
  // URL. A failed read throws, so a view is never built from missing data.
  const [units, leases, listings, images, concessions] = await Promise.all([
    readIn(unitIds, (ids) => db.from("listing_units").select("id, name, bedrooms, bathrooms, area, floor_plan_image_url").in("id", ids)),
    readIn(leaseIds, (ids) => db.from("unit_leases").select("id, unit_id, rent, rent_is_per_person, lease_term_months, available_from, description, unavailable").in("id", ids)),
    readIn(listingIds, (ids) => db.from("listings").select("id, title, description, furnished, address, contact_name, contact_email, contact_phone").in("id", ids)),
    readIn(listingIds, (ids) => db.from("listing_images").select("listing_id, unit_id, source").in("listing_id", ids).limit(5000)),
    readIn(listingIds, (ids) => db.from("listing_concessions").select("listing_id, description, active").in("listing_id", ids).eq("active", true)),
  ]);
  const unitBy = new Map(units.map((u) => [u.id, u]));
  const leaseBy = new Map(leases.map((l) => [l.id, l]));
  const listingBy = new Map(listings.map((l) => [l.id, l]));
  // Photos counted once per listing and unit ("" for the property's own photos).
  const photos = new Map();
  for (const i of images) {
    if (i.source === "street_view") continue;
    const k = `${i.listing_id}|${i.unit_id ?? ""}`;
    photos.set(k, (photos.get(k) ?? 0) + 1);
  }
  const photoCount = (listingId, unitId) => photos.get(`${listingId}|${unitId ?? ""}`) ?? 0;
  const specialsOf = (listingId) => concessions.filter((c) => c.listing_id === listingId).map((c) => c.description);

  const out = new Map();
  for (const e of list) {
    const d = e.detail ?? {};
    const unit = d.unitId ? unitBy.get(d.unitId) : null;
    const lease = d.leaseId ? leaseBy.get(d.leaseId) : null;
    const oldV = e.old_value ?? {};
    const newV = e.new_value ?? {};
    let view;
    switch (e.kind) {
      case "rent_change":
      case "lease_updated": {
        const fields = String(e.field ?? "").split(",").filter(Boolean);
        const live = lease ?? { rent: oldV.rent, lease_term_months: oldV.leaseTermMonths, available_from: oldV.availableFrom, description: oldV.apartments };
        view = { title: e.kind === "rent_change" ? "Rent change" : "Lease details changed", rows: leaseRows(fields, live, newV) };
        break;
      }
      case "lease_new":
        view = {
          title: "New lease on the website",
          // Only what the website actually gives for the new lease.
          rows: leaseRows(["rent", "leaseTermMonths", "availableFrom", "apartments"], null, newV).filter((r) => r.label === "Rent" || r.proposed !== NOT_GIVEN),
        };
        break;
      case "lease_withdrawn":
        view = {
          title: "Lease no longer on the website",
          rows: [row("This lease", lease ? `${money(lease.rent, lease.rent_is_per_person)}, ${lease.unavailable ? "already unavailable" : "available"}` : money(d.rent), "Not on the website: mark it unavailable")],
        };
        break;
      case "unit_relisted":
        view = {
          title: "Lease back on the website",
          rows: [row("This lease", lease ? `${money(lease.rent, lease.rent_is_per_person)}, unavailable` : "Unavailable", "On the website again: make it available"),
            ...leaseRows(Object.keys(d.patch ?? {}).map((k) => ({ lease_term_months: "leaseTermMonths", available_from: "availableFrom", description: "apartments" })[k]).filter(Boolean), lease, d.patch ?? {})],
        };
        break;
      case "unit_new": {
        const u = d.unit ?? newV;
        const prices = (d.offers ?? []).map((o) => money(o.rent, o.rentIsPerPerson)).join(", ");
        view = {
          title: "New unit type on the website",
          rows: [
            row("Unit type", NOT_ON_PROXIMITY, [cleanLabel(u.name), layout(u), sqft(u.area)].filter(Boolean).join(", ")),
            ...(prices ? [row("Prices", NOT_ON_PROXIMITY, prices)] : []),
          ],
          note: "Added as a draft until you publish it.",
        };
        break;
      }
      case "unit_updated": {
        const p = d.patch ?? newV;
        view = {
          title: "Details the website fills in",
          rows: Object.keys(p).map((f) => f === "floorPlanImageUrl"
            ? row("Floor plan image", unit?.floor_plan_image_url ? "Has one" : "None", "Image from the website")
            : row(SPEC_LABEL[f] ?? f, specText(f, unit?.[f] ?? null) ?? "Not set", specText(f, p[f]))),
        };
        break;
      }
      case "spec_mismatch":
        view = {
          title: "The website lists this unit differently",
          rows: Object.keys(newV).map((f) => row(SPEC_LABEL[f] ?? f, specText(f, unit?.[f] ?? oldV[f]), specText(f, newV[f]))),
          note: "Beds, baths, size and name are never changed automatically.",
        };
        break;
      case "missing_unit":
        view = {
          title: "Unit not on the website",
          rows: [row("Unit", unitName(unit, d.label) ?? layout(oldV), "Not on the website")],
          note: "Nothing is removed automatically.",
        };
        break;
      case "photos_added": {
        const listingId = e.listing_id;
        const n = listingId ? photoCount(listingId, d.unitId ?? null) : null;
        view = { title: "Photos from the website", rows: [row("Photos", n == null ? null : `${n} photo${n === 1 ? "" : "s"}`, `Add ${e.new_value} photo${Number(e.new_value) === 1 ? "" : "s"}`)] };
        break;
      }
      case "property_updated": {
        const live = listingBy.get(e.listing_id) ?? {};
        const rows = Object.entries(d.patch ?? {}).map(([f, v]) =>
          row(PROPERTY_LABEL[f] ?? f, f === "furnished" ? (live[f] == null ? null : live[f] ? "Yes" : "No") : short(live[f]), f === "furnished" ? (v ? "Yes" : "No") : short(v)));
        if ((d.concessions ?? []).length || (d.staleConcessions ?? []).length) {
          const now = specialsOf(e.listing_id);
          rows.push(row("Specials", now.length ? now.map((s) => short(s, 90)).join(" · ") : "None", (d.concessions ?? []).length ? uniqueSpecials(d.concessions).map((s) => short(s, 90)).join(" · ") : "None"));
        }
        if ((d.amenities ?? []).length || (d.customAmenities ?? []).length) rows.push(row("Amenities", "Not listed", `Add: ${[...(d.amenities ?? []), ...(d.customAmenities ?? [])].join(", ")}`));
        if ((d.utilities ?? []).length) rows.push(row("Utilities included", "Not listed", `Add: ${d.utilities.join(", ")}`));
        view = { title: "Property details from the website", rows };
        break;
      }
      case "churn_hold":
        view = { title: "Whole update held", rows: [], note: `More than a fifth of this listing's leases would change at once (${newV.changes ?? "several"} changes), so nothing on this listing was applied automatically.` };
        break;
      case "low_confidence":
        view = { title: "Whole update held", rows: [], note: `The website was hard to read reliably (${newV.changes ?? "several"} changes found), so nothing on this listing was applied automatically.` };
        break;
      default:
        view = { title: String(e.kind).replace(/_/g, " "), rows: [] };
    }
    const unitLabel = e.kind === "unit_new" || e.kind === "property_updated" || e.kind === "churn_hold" || e.kind === "low_confidence" || e.kind === "missing_unit"
      ? null
      : [unitName(unit, d.label), lease && !["lease_withdrawn", "unit_relisted"].includes(e.kind) ? `${money(lease.rent, lease.rent_is_per_person)} lease` : null].filter(Boolean).join(", ") || null;
    out.set(e.id, { ...view, unit: unitLabel });
  }
  return out;
}
