/*
 * The pure rules behind listing updates from chat messages
 * (chatListingUpdates.js): no database, no model, so they can be tested.
 */
// Relative imports: chatListingRules.test.js runs under node --test, which does not know the @/ alias.
import { money, shortDate, todayChicago } from "./sections.js";
import { textHasAddress } from "../sourceImport/evidence.js";

/* "Currently" reaches offerings whose move-in is at most this far away. */
const NOW_WINDOW_DAYS = 60;

/* A new rent further than this from the saved one (either way) is not trusted. */
const MAX_RENT_MOVE = 2;

/*
 * Text as compared for the quote check. The model's output has its em dashes
 * turned into ", " (model.js stripEmDashes), so dashes, commas and the spaces
 * around them all count as one gap on both sides.
 */
const norm = (s) => String(s ?? "").toLowerCase()
  .replace(/[‘’]/g, "'").replace(/[“”]/g, "\"")
  .replace(/\s*[\u2014\u2013,]\s*/g, " ")
  .replace(/\s+/g, " ").trim();

function parseValue(field, raw, today) {
  const v = String(raw ?? "").trim();
  if (field === "unavailable") return /^(true|yes|1)$/i.test(v) ? true : /^(false|no|0)$/i.test(v) ? false : undefined;
  if (field === "available_from") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return undefined;
    // A move-in date in the past is a misread (a date with no year taken as this year).
    return today && v < today ? null : v;
  }
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
 * A rent the landlord stated, in the lease's own terms (Wyatt, 2026-11-25):
 * landlords say "$600" meaning a bed as often as the whole unit, so the
 * stated figure is compared with the saved rent. Both readings are tried, as
 * stated and converted (per bedroom times bedrooms, or the unit over
 * bedrooms), and the one closer to the saved rent wins. $1,500 saved for a
 * 3 bed and "$600" stated: $600 x 3 = $1,800. Neither reading within 2x of
 * the saved rent, or no saved rent on a unit with 2+ bedrooms: null.
 * Returns { value, note } with note saying how a converted figure was found.
 */
export function rentInLeaseTerms(stated, lease) {
  const old = lease.rent == null ? null : Number(lease.rent);
  const beds = Number(lease.listing_units?.bedrooms) || 0;
  if (!old) return beds >= 2 ? null : { value: stated, note: null };
  const move = (v) => Math.max(v, old) / Math.min(v, old);
  const options = [{ value: stated, note: null }];
  if (beds >= 2) {
    options.push(lease.rent_is_per_person
      ? { value: Math.round(stated / beds), note: `${money(stated)} for the unit over ${beds} bedrooms` }
      : { value: stated * beds, note: `${money(stated)} per bedroom x ${beds}` });
  }
  const best = options.sort((a, b) => move(a.value) - move(b.value))[0];
  return move(best.value) > MAX_RENT_MOVE ? null : best;
}

/*
 * Turn the model's reading into concrete changes against the offerings.
 * Pure: no database, no model. Returns { changes, skipped } where skipped
 * says why nothing applies. Each change says whether it came from a
 * whole-property statement (all), and for rent what the landlord said (said).
 */
export function planChanges({ reading, text, leases, ownerLeaseIds = null, today = todayChicago() }) {
  if (!reading) return { changes: [], skipped: "could not read the message" };
  if (reading.about !== "listing_change") return { changes: [], skipped: reading.about };
  if (!reading.changes?.length) return { changes: [], skipped: "unclear which offering" };
  if (!reading.quote || !norm(text).includes(norm(reading.quote))) return { changes: [], skipped: "quote not found in the message" };
  const byCode = new Map(leases.map((l) => [l.code, l]));
  const out = [];
  const seen = new Set();
  let why = null;
  for (const c of reading.changes) {
    const value = parseValue(c.field, c.value, today);
    if (value === undefined) continue;
    if (value === null) {
      why = "a move-in date in the past";
      continue;
    }
    const code = String(c.offering ?? "").trim().toUpperCase();
    const all = code === "ALL";
    let targets;
    if (all) {
      // "Nothing available" withdraws what is on the market now; other fields need a named offering.
      if (c.field !== "unavailable" || value !== true) continue;
      const live = leases.filter(onMarket);
      targets = live.filter((l) => availableNow(l, today));
      if (live.length && !targets.length) why = "only offerings for a later move-in, which a statement about now does not reach";
    } else {
      const l = byCode.get(code);
      if (!l) {
        why = "unclear which offering";
        continue;
      }
      targets = [l];
      // "Taken" said today does not reach an offering for a later move-in.
      if (c.field === "unavailable" && value === true && !availableNow(l, today)) {
        targets = [];
        why = "only offerings for a later move-in, which a statement about now does not reach";
      }
    }
    for (const l of targets) {
      if (ownerLeaseIds && !ownerLeaseIds.has(l.id)) continue;
      const key = `${l.id}:${c.field}`;
      if (seen.has(key)) continue;
      let to = value;
      let note = null;
      if (c.field === "rent") {
        const r = rentInLeaseTerms(value, l);
        if (!r) {
          why = "the new rent is too far from the saved rent to tell whether it is per person or for the unit";
          continue;
        }
        ({ value: to, note } = r);
      }
      seen.add(key);
      const current = c.field === "unavailable" ? !onMarket(l) : c.field === "available_from" ? (l.available_from ? String(l.available_from).slice(0, 10) : null) : l.rent == null ? null : Number(l.rent);
      if (current === to) continue;
      out.push({
        leaseId: l.id,
        offering: l.code,
        unit: l.listing_units?.name || l.listing_units?.title || null,
        field: c.field,
        from: current,
        to,
        said: value,
        ...(note ? { note } : {}),
        all,
        wasActive: l.is_active !== false,
      });
    }
  }
  if (out.length) return { changes: out, skipped: null };
  return { changes: [], skipped: why ?? "already matches the listing" };
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
  return namesTheUnit(text, unit);
}

/* The message names this unit itself ("the Garden Loft"), not a vague "the unit". */
export function namesTheUnit(text, unit) {
  const u = plain(unit);
  return !!u && u.length >= 3 && !VAGUE_NAMES.has(u) && ` ${plain(text)} `.includes(` ${u} `);
}

/* Plain words for one change, for the admin view and reports. */
export function changeLabel(c) {
  const what = c.unit ? `${c.unit}` : "offering";
  if (c.field === "unavailable") return c.to ? `${what}: take off the market` : `${what}: put back on the market`;
  if (c.field === "available_from") return `${what}: available from ${c.from ? shortDate(c.from) : "now"} to ${shortDate(c.to)}`;
  if (c.field === "rent") return `${what}: rent ${c.from == null ? "none" : money(c.from)} to ${money(c.to)}${c.note ? ` (${c.note})` : ""}`;
  return `${what}: ${c.field}`;
}
