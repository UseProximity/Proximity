/*
 * The text each fact of a read came from, for Jev to check (sync confidence
 * ledger, stage 2). A read keeps, for each unit, the stretch of page text
 * around its name (or, for a plan with no name, around its price), and the
 * head of the main page for the right-building question.
 *
 * Kept on the snapshot in memory only (snapshot.evidence): sync.js leaves it
 * out of the stored snapshot. Pure.
 */

export const EVIDENCE_CHARS = 8000;

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/* "$1,895", "1,895" and "1895" for one rent. */
function rentNeedles(rent) {
  const n = Math.round(Number(rent));
  if (!(n > 0)) return [];
  const comma = n.toLocaleString("en-US");
  return [...new Set([`$${comma}`, comma, String(n)])];
}

function nameRe(name) {
  const parts = String(name ?? "").split(/[^A-Za-z0-9]+/).filter(Boolean).map(escapeRe);
  return parts.length ? new RegExp(`(?<![A-Za-z0-9])${parts.join("[^A-Za-z0-9]{0,3}")}(?![A-Za-z0-9])`, "i") : null;
}

/* Where a unit is named in a text: the index, or -1. Words in any spacing. */
export function findUnit(text, unit) {
  const name = String(unit?.name ?? "").trim();
  if (name) {
    // Whole name only: "IvaS1" is not found inside "IvaS10".
    const m = nameRe(name)?.exec(text);
    if (m) return m.index + (m[0].length - m[0].replace(/^[^A-Za-z0-9]+/, "").length);
  }
  for (const o of unit?.offers ?? []) {
    for (const needle of rentNeedles(o.rent)) {
      const i = text.indexOf(needle);
      if (i >= 0) return i;
    }
  }
  return -1;
}

// A unit's own block: from just before its name to the next unit's name.
const WINDOW_BEFORE = 150;
const WINDOW_MAX = 1500;
const WINDOW_MIN = 300;
const PAGE_CHARS = 60000;


/*
 * The stretch of text about one unit: from its name to the next other unit's
 * name, so a neighbour's "From $1,165" is not read as this unit's price
 * (Union at the Grove, 2026-11-24). Returns { url, text } or null.
 *   others  the other units' names on the same read
 */
export function unitWindow(pages, unit, others = []) {
  for (const p of pages ?? []) {
    const i = findUnit(p.text, unit);
    if (i < 0) continue;
    const after = i + Math.max(1, String(unit?.name ?? "").length);
    let end = i + WINDOW_MAX;
    let bounded = false;
    for (const o of others) {
      const re = nameRe(o);
      if (!re || (unit?.name && nameRe(unit.name)?.test(o))) continue;
      const m = re.exec(p.text.slice(after, i + WINDOW_MAX));
      if (m) {
        end = Math.min(end, after + m.index);
        bounded = true;
      }
    }
    if (!bounded) end = Math.max(end, i + WINDOW_MIN);
    return { url: p.url, text: p.text.slice(Math.max(0, i - WINDOW_BEFORE), end) };
  }
  return null;
}

/*
 * pages    [{ url, text }], main page first
 * units    the snapshot's units
 * address  the listing's address, to note whether any page states it
 * Returns { page: { url, text }, pages, units: { [unit key]: { url, text } }, addressSeen }.
 */
export function collectEvidence(pages, units, address = null) {
  const list = (pages ?? []).filter((p) => p?.text).map((p) => ({ url: p.url, text: p.text.slice(0, PAGE_CHARS) }));
  const names = (units ?? []).map((u) => u?.name).filter(Boolean);
  const out = {
    page: list[0] ? { url: list[0].url, text: list[0].text.slice(0, EVIDENCE_CHARS) } : null,
    pages: list,
    units: {},
    addressSeen: address ? list.some((p) => textHasAddress(p.text, address)) : false,
  };
  for (const u of units ?? []) {
    if (!u?.key) continue;
    const w = unitWindow(list, u, names.filter((n) => n !== u.name));
    if (w) out.units[u.key] = w;
  }
  return out;
}

/* Whether a text names the listing's street address (number and street name). */
export function textHasAddress(text, address) {
  const m = String(address ?? "").match(/^\s*(\d+[A-Za-z]?)\s+([A-Za-z0-9.' ]+?)(?:,|$)/);
  if (!m || !text) return false;
  const street = m[2].trim().split(/\s+/).filter((w) => !/^(st|street|ave|avenue|blvd|boulevard|rd|road|dr|drive|pl|place|ct|court|ln|lane|n|s|e|w|north|south|east|west)\.?$/i.test(w));
  if (!street.length) return false;
  return new RegExp(`\\b${escapeRe(m[1])}\\b[^\\n]{0,8}${escapeRe(street[0])}`, "i").test(text);
}
