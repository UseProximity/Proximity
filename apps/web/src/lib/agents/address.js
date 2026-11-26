/*
 * Street addresses, read loosely enough to compare a listing with a page that
 * writes the same place differently: "7342 Dartmouth Avenue, University City,
 * Missouri 63130" and the Zillow slug "7342-Dartmouth-Ave-Saint-Louis-MO-63130"
 * are one address; 7344 Dartmouth is a neighbour, not a match.
 *
 * A match needs the house number (or a range covering it, "5386-5390
 * Pershing"), the same street name and suffix-insensitive core, the same
 * direction when both say one, and the same ZIP when both give one. City names
 * are ignored: St. Louis addresses are written with several (Saint Louis,
 * University City, Clayton) for the same building.
 *
 * Pure on purpose. address.test.js covers it.
 */

const SUFFIXES = {
  avenue: "ave", ave: "ave", av: "ave",
  boulevard: "blvd", blvd: "blvd",
  street: "st", st: "st",
  drive: "dr", dr: "dr",
  place: "pl", pl: "pl",
  road: "rd", rd: "rd",
  court: "ct", ct: "ct",
  lane: "ln", ln: "ln",
  parkway: "pkwy", pkwy: "pkwy",
  terrace: "ter", ter: "ter",
  way: "way",
  circle: "cir", cir: "cir",
  square: "sq", sq: "sq",
  highway: "hwy", hwy: "hwy",
};
const DIRECTIONS = { north: "n", n: "n", south: "s", s: "s", east: "e", e: "e", west: "w", w: "w" };

const words = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9#-]+/g, " ").trim().split(/\s+/).filter(Boolean);

/*
 * "5386-5390 Pershing Ave, Saint Louis, MO 63112" -> { from: 5386, to: 5390,
 * dir: null, name: "pershing", suffix: "ave", zip: "63112" }. Null when there
 * is no house number followed by a street name.
 */
export function parseAddress(text) {
  const s = String(text ?? "").replace(/-/g, " - ");
  const m = /(\d{1,6})(?:\s*-\s*(\d{1,6}))?\s+([a-z][a-z .']{1,60})/i.exec(s);
  if (!m) return null;
  const from = Number(m[1]);
  const to = m[2] ? Number(m[2]) : from;
  const tokens = words(m[3]);
  let dir = null;
  if (tokens.length > 1 && DIRECTIONS[tokens[0]]) dir = DIRECTIONS[tokens.shift()];
  const nameParts = [];
  let suffix = null;
  for (const t of tokens) {
    if (SUFFIXES[t]) { suffix = SUFFIXES[t]; break; }
    nameParts.push(t);
    if (nameParts.length >= 3) break;
  }
  if (!nameParts.length) return null;
  const zip = /\b(6\d{4})\b/.exec(String(text ?? ""))?.[1] ?? null;
  return { from: Math.min(from, to), to: Math.max(from, to), dir, name: nameParts.join(" "), suffix, zip };
}

/*
 * Every address-like run in a page's title, URL and text: "7342 Dartmouth
 * Ave", or a URL slug with its dashes read as spaces.
 */
export function addressesIn(text) {
  const s = String(text ?? "").replace(/[-_/]+/g, " ");
  const out = [];
  const re = /\b(\d{1,6})(?:\s+(\d{1,6}))?\s+((?:[nsew]|north|south|east|west)\s+)?([a-z][a-z']{1,30}(?:\s+[a-z][a-z']{1,30}){0,2})\s+(avenue|ave|av|boulevard|blvd|street|st|drive|dr|place|pl|road|rd|court|ct|lane|ln|parkway|pkwy|terrace|ter|way|circle|cir|square|sq|highway|hwy)\b([^\d]{0,60}?(6\d{4}))?/gi;
  let m;
  while ((m = re.exec(s)) && out.length < 40) {
    const from = Number(m[1]);
    // A second number counts as a range only when it is close ("5386 5390"),
    // not when a slug runs into an id.
    const second = m[2] ? Number(m[2]) : null;
    const to = second && second > from && second - from <= 40 ? second : from;
    const name = words(m[4]).join(" ");
    out.push({
      from, to,
      dir: m[3] ? DIRECTIONS[words(m[3])[0]] : null,
      name,
      suffix: SUFFIXES[m[5].toLowerCase()] ?? null,
      zip: m[7] ?? null,
      text: m[0].trim().slice(0, 80),
    });
  }
  return out;
}

// The words of a street name that identify it ("the" and directions dropped).
const core = (name) => words(name).filter((w) => w !== "the" && !DIRECTIONS[w]).join(" ");

/*
 * How a page's addresses compare with the listing's:
 *   "exact"     number in range, same street, no conflicting direction or ZIP
 *   "street"    same street, different number (a neighbour)
 *   "none"
 * With the address seen, for the evidence line.
 */
export function compareAddress(listingAddress, pageText) {
  const want = typeof listingAddress === "string" ? parseAddress(listingAddress) : listingAddress;
  if (!want) return { level: "none", seen: null };
  let street = null;
  for (const a of addressesIn(pageText)) {
    if (core(a.name) !== core(want.name)) continue;
    if (want.dir && a.dir && want.dir !== a.dir) continue;
    if (want.suffix && a.suffix && want.suffix !== a.suffix) continue;
    const overlaps = a.from <= want.to && want.from <= a.to;
    if (!overlaps) { street ??= a; continue; }
    if (want.zip && a.zip && want.zip !== a.zip) continue;
    return { level: "exact", seen: a.text };
  }
  return street ? { level: "street", seen: street.text } : { level: "none", seen: null };
}

/*
 * A listing title that names the building ("The Koken", "Central Park"), or
 * null when the title is just the street address again.
 */
export function buildingName(title, address) {
  const t = String(title ?? "").trim();
  if (!t || t.length < 3) return null;
  if (/^\d/.test(t)) return null;
  const p = parseAddress(address);
  if (p && core(t).includes(core(p.name)) && /\d/.test(t)) return null;
  return t;
}

// The name, as words, appears in the text ("the koken" in "The Koken - 2528 Texas Ave").
export function mentionsName(name, text) {
  if (!name) return false;
  const n = words(name).filter((w) => w !== "the").join(" ");
  if (n.length < 4) return false;
  return ` ${words(text).join(" ")} `.includes(` ${n} `);
}
