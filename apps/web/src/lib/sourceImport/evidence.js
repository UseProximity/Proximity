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
const BEFORE = 1500;

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/* "$1,895", "1,895" and "1895" for one rent. */
function rentNeedles(rent) {
  const n = Math.round(Number(rent));
  if (!(n > 0)) return [];
  const comma = n.toLocaleString("en-US");
  return [...new Set([`$${comma}`, comma, String(n)])];
}

/* Where a unit is named in a text: the index, or -1. Words in any spacing. */
export function findUnit(text, unit) {
  const name = String(unit?.name ?? "").trim();
  if (name) {
    const re = new RegExp(name.split(/[^A-Za-z0-9]+/).filter(Boolean).map(escapeRe).join("[^A-Za-z0-9]{0,3}"), "i");
    const m = re.exec(text);
    if (m) return m.index;
  }
  for (const o of unit?.offers ?? []) {
    for (const needle of rentNeedles(o.rent)) {
      const i = text.indexOf(needle);
      if (i >= 0) return i;
    }
  }
  return -1;
}

/*
 * pages   [{ url, text }], main page first
 * units   the snapshot's units
 * Returns { page: { url, text }, units: { [unit key]: { url, text } } }.
 */
export function collectEvidence(pages, units) {
  const list = (pages ?? []).filter((p) => p?.text);
  const out = { page: list[0] ? { url: list[0].url, text: list[0].text.slice(0, EVIDENCE_CHARS) } : null, units: {} };
  for (const u of units ?? []) {
    if (!u?.key) continue;
    for (const p of list) {
      const i = findUnit(p.text, u);
      if (i < 0) continue;
      const start = Math.max(0, i - BEFORE);
      out.units[u.key] = { url: p.url, text: p.text.slice(start, start + EVIDENCE_CHARS) };
      break;
    }
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
