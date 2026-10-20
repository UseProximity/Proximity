/*
 * Floor plans embedded as JSON in a page.
 *
 * Mac Properties' site (Storyblok on Netlify) draws each building's floor
 * plans from a RentCafe feed and ships the whole feed inside the page's
 * script data, escaped as a JS string. Every plan is there with the fields
 * the visible page only partly shows:
 *
 *   { "floorplanId": 6313870, "floorplanName": "100N101a", "beds": 1,
 *     "baths": 1, "isWaitlist": false, "availableUnitCount": 2, "sqft": 826,
 *     "minRent": 3080, "maxRent": 3095, "specialText": "6 Weeks Free! ...",
 *     "imageUrls": [ ...room photos..., ".../100-Floorplan-2H_2_FP.jpg" ],
 *     "thumbnailUrl": "...", "unitAvailableDates": ["11/01/2026"] }
 *
 * Reading this beats the model reading the rendered text (which lost the
 * square footage and every diagram) and beats opening thirty-six plan pages
 * through a render service. Parsed by brace-matching on the unescaped text,
 * so it does not depend on which script tag or framework carried it.
 */
import { isoDate } from "../snapshot.js";

export const EMBEDDED_HINT_RE = /\\?"floorplanName\\?"\s*:/;

function unescapeJs(s) {
  return s
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\\//g, "/")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");
}

/* Every top-level JSON object in `text` that contains the needle. */
function objectsContaining(text, needle) {
  const out = [];
  let from = 0;
  for (;;) {
    const at = text.indexOf(needle, from);
    if (at < 0) break;
    // Walk back to the "{" that opens this object.
    let depth = 0;
    let start = -1;
    for (let i = at; i >= 0; i--) {
      const ch = text[i];
      if (ch === "}") depth++;
      else if (ch === "{") {
        if (depth === 0) {
          start = i;
          break;
        }
        depth--;
      }
    }
    if (start < 0) {
      from = at + needle.length;
      continue;
    }
    // Walk forward to its matching "}".
    depth = 0;
    let end = -1;
    let inStr = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inStr) {
        if (ch === "\\") i++;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          end = i + 1;
          break;
        }
      }
    }
    if (end < 0) break;
    try {
      out.push(JSON.parse(text.slice(start, end)));
    } catch {
      /* not clean JSON here; keep looking */
    }
    from = end;
  }
  return out;
}

const PLAN_IMAGE_RE = /floor-?plan|floorplan|_fp\.(jpe?g|png|webp)$|-fp[._-]/i;
const ROOM_RE = /kitchen|living|bedroom|bath|closet|dining|balcony|view|exterior|lobby|amenity/i;

/*
 * Returns { units, concessions, notes } or null when the page carries no
 * embedded plans. Raw snapshot units, one offer per plan at its lowest rent.
 */
export function parseEmbeddedFloorPlans(html) {
  if (!html || !EMBEDDED_HINT_RE.test(html)) return null;
  const text = unescapeJs(html);
  const plans = objectsContaining(text, '"floorplanName"').filter((p) => typeof p.floorplanName === "string");
  if (!plans.length) return null;

  const units = [];
  const concessions = new Set();
  const seen = new Set();
  let skipped = 0;
  for (const p of plans) {
    const name = p.floorplanName.trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    const images = (p.imageUrls ?? []).filter((u) => typeof u === "string" && /^https?:/.test(u));
    const diagram = images.find((u) => PLAN_IMAGE_RE.test(u.split("/").pop() ?? "") && !ROOM_RE.test((u.split("/").pop() ?? "").replace(/_fp\./i, "."))) ?? null;
    const rooms = images.filter((u) => u !== diagram && !/thumbnail/i.test(u));
    const minRent = Number(p.minRent) > 0 ? Math.round(Number(p.minRent)) : null;
    const maxRent = Number(p.maxRent) > 0 ? Math.round(Number(p.maxRent)) : null;
    const sqft = Number(p.sqft) > 0 ? Number(p.sqft) : Number(p.minSqft) > 0 ? Number(p.minSqft) : null;
    const dates = (p.unitAvailableDates ?? []).map(isoDate).filter(Boolean).sort();
    const waitlist = p.isWaitlist === true || (Number(p.availableUnitCount) === 0 && minRent == null);
    if (p.specialText) concessions.add(String(p.specialText).trim());
    /*
     * A plan nobody can rent today and that has no price is the building's
     * catalogue, not its inventory: One Hundred lists 75 plans of which 34
     * are available. The rest arrive as new units the week they free up,
     * which is what the sync is for. A waitlisted plan with a price stays,
     * switched off, as everywhere else.
     */
    const availableCount = Number.isFinite(Number(p.availableUnitCount)) ? Number(p.availableUnitCount) : null;
    if (minRent == null && !availableCount) {
      skipped += 1;
      continue;
    }
    units.push({
      name,
      bedrooms: Number.isFinite(Number(p.beds)) ? Number(p.beds) : null,
      bathrooms: Number.isFinite(Number(p.baths)) ? Number(p.baths) : null,
      area: sqft,
      floorPlanImageUrl: diagram,
      available: !waitlist,
      photos: rooms.slice(0, 8),
      offers:
        minRent == null
          ? []
          : [{ rent: minRent, rentIsPerPerson: false, leaseTermMonths: [], availableFrom: dates[0] ?? null, apartments: [] }],
      rentRange: maxRent && maxRent !== minRent ? [minRent, maxRent] : null,
      availableUnitCount: Number.isFinite(Number(p.availableUnitCount)) ? Number(p.availableUnitCount) : null,
    });
  }
  if (!units.length) return null;
  const notes = [];
  if (skipped) notes.push(`${skipped} floor plan${skipped === 1 ? "" : "s"} with no available apartments and no price were left out; they are added when they free up.`);
  const ranged = units.filter((u) => u.rentRange).length;
  if (ranged) {
    notes.push(`${ranged} floor plan${ranged === 1 ? " shows" : "s show"} a rent range on the site; the lowest figure was imported as the lease price.`);
  }
  if (units.every((u) => !u.offers.length || !u.offers[0].leaseTermMonths.length)) {
    notes.push("The site does not publish lease lengths on its floor plans. Choose them for each lease before publishing.");
  }
  return { units, concessions: [...concessions], notes };
}
