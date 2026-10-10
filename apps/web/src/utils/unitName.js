/*
 * A unit's name: "Apt 2W", "Unit D1", "The Loft", "Whole property".
 *
 * listing_units.name is the one place a unit's name lives. It replaced a
 * type + number pair and a separate floor plan name, which different screens
 * read in different orders, so the same unit could carry two names at once.
 */

export const UNIT_NAME_MAX = 80;

// What gets stored: trimmed, inner whitespace collapsed, capped. Empty is null,
// which every screen renders as a beds/baths description instead of a name.
export function cleanUnitName(value) {
  if (typeof value !== "string") return null;
  const name = value.replace(/\s+/g, " ").trim().slice(0, UNIT_NAME_MAX);
  return name || null;
}

// Two names are the same unit if they differ only in case or spacing.
export function unitNameKey(value) {
  return (cleanUnitName(value) ?? "").toLowerCase();
}

/*
 * The add-listing wizard describes several identical units on one card, so its
 * name field takes a list: "Apt 2W, Apt 2E" or a range, "Apt 101-104", which
 * expands to Apt 101 through Apt 104. Commas separate names (names themselves
 * contain spaces). Duplicates collapse.
 */
export function parseUnitNames(raw) {
  const out = [];
  for (const token of String(raw ?? "").split(",")) {
    const name = cleanUnitName(token);
    if (!name) continue;
    const range = name.match(/^(.*?)(\d+)-(\d+)$/);
    if (range) {
      const [prefix, from, to] = [range[1], Number(range[2]), Number(range[3])];
      // Guard against a typo like "1-9999" silently creating thousands of units.
      if (from <= to && to - from < 200) {
        for (let n = from; n <= to; n++) out.push(`${prefix}${n}`);
        continue;
      }
    }
    out.push(name);
  }
  const seen = new Set();
  return out.filter((n) => {
    const key = unitNameKey(n);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
