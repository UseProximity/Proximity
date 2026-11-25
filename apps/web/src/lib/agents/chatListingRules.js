/*
 * The pure rules behind listing updates from chat messages
 * (chatListingUpdates.js): no database, no model, so they can be tested.
 */
import { money, shortDate, todayChicago } from "./sections.js";
import { textHasAddress } from "../sourceImport/evidence.js";

/* "Currently" reaches offerings whose move-in is at most this far away. */
const NOW_WINDOW_DAYS = 60;

const norm = (s) => String(s ?? "").toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, "\"").replace(/\s+/g, " ").trim();

function parseValue(field, raw) {
  const v = String(raw ?? "").trim();
  if (field === "unavailable") return /^(true|yes|1)$/i.test(v) ? true : /^(false|no|0)$/i.test(v) ? false : undefined;
  if (field === "available_from") return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined;
  if (field === "rent") {
    const n = Number(v.replace(/[$,\s]/g, ""));
    return Number.isFinite(n) && n >= 100 && n <= 20000 ? n : undefined;
  }
  return undefined;
}

const onMarket = (l) => !l.unavailable && l.is_active !== false;

/* Move-in now or soon: what "currently" can speak for. */
export function availableNow(lease, today) {
  if (!lease.available_from) return true;
  const limit = new Date(`${today}T00:00:00Z`).getTime() + NOW_WINDOW_DAYS * 86400000;
  return new Date(`${String(lease.available_from).slice(0, 10)}T00:00:00Z`).getTime() <= limit;
}

/*
 * Turn the model's reading into concrete changes against the offerings.
 * Pure: no database, no model. Returns { changes, skipped } where skipped
 * says why nothing applies.
 */
export function planChanges({ reading, text, leases, ownerLeaseIds = null, today = todayChicago() }) {
  if (!reading) return { changes: [], skipped: "could not read the message" };
  if (reading.about !== "listing_change") return { changes: [], skipped: reading.about };
  if (!reading.changes?.length) return { changes: [], skipped: "unclear which offering" };
  if (!reading.quote || !norm(text).includes(norm(reading.quote))) return { changes: [], skipped: "quote not found in the message" };
  const byCode = new Map(leases.map((l) => [l.code, l]));
  const out = [];
  const seen = new Set();
  let laterTermOnly = false;
  for (const c of reading.changes) {
    const value = parseValue(c.field, c.value);
    if (value === undefined) continue;
    let targets;
    if (String(c.offering).toUpperCase() === "ALL") {
      // "Nothing available" withdraws what is on the market now; other fields need a named offering.
      if (c.field !== "unavailable" || value !== true) continue;
      const live = leases.filter(onMarket);
      targets = live.filter((l) => availableNow(l, today));
      if (live.length && !targets.length) laterTermOnly = true;
    } else {
      const l = byCode.get(String(c.offering).toUpperCase());
      targets = l ? [l] : [];
      // "Taken" said today does not reach an offering for a later move-in.
      if (l && c.field === "unavailable" && value === true && !availableNow(l, today)) {
        targets = [];
        laterTermOnly = true;
      }
    }
    for (const l of targets) {
      if (ownerLeaseIds && !ownerLeaseIds.has(l.id)) continue;
      const key = `${l.id}:${c.field}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const current = c.field === "unavailable" ? !onMarket(l) : c.field === "available_from" ? (l.available_from ? String(l.available_from).slice(0, 10) : null) : l.rent == null ? null : Number(l.rent);
      if (current === value) continue;
      out.push({
        leaseId: l.id,
        offering: l.code,
        unit: l.listing_units?.name || l.listing_units?.title || null,
        field: c.field,
        from: current,
        to: value,
        wasActive: l.is_active !== false,
      });
    }
  }
  if (out.length) return { changes: out, skipped: null };
  return { changes: [], skipped: laterTermOnly ? "only offerings for a later move-in, which a statement about now does not reach" : "already matches the listing" };
}

const plain = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const VAGUE_NAMES = new Set(["whole property", "unit", "apartment", "studio", "house", "the unit"]);

/*
 * Right thing, by code (as the sync does, jevPass.js): the message must name
 * the property (its street address or title) or the unit. A message that
 * names neither ("we're fully leased") is generic and changes nothing.
 */
export function namesTheProperty(text, { listing, unit = null }) {
  if (textHasAddress(text, listing.address)) return true;
  const t = ` ${plain(text)} `;
  const title = plain(listing.title);
  // A title that is only the address was checked above; a short one ("Lofts") is too common.
  if (title.length >= 6 && !/^\d/.test(title) && t.includes(` ${title} `)) return true;
  const u = plain(unit);
  return !!u && u.length >= 3 && !VAGUE_NAMES.has(u) && t.includes(` ${u} `);
}

/* Plain words for one change, for the admin view and reports. */
export function changeLabel(c) {
  const what = c.unit ? `${c.unit}` : "offering";
  if (c.field === "unavailable") return c.to ? `${what}: take off the market` : `${what}: put back on the market`;
  if (c.field === "available_from") return `${what}: available from ${c.from ? shortDate(c.from) : "now"} to ${shortDate(c.to)}`;
  if (c.field === "rent") return `${what}: rent ${c.from == null ? "none" : money(c.from)} to ${money(c.to)}`;
  return `${what}: ${c.field}`;
}
