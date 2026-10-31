/*
 * A unit's name: "Apt 2W", "Unit D1", "The Loft", "Whole property".
 *
 * listing_units.name is the one place a unit's name lives. It replaced a
 * type + number pair and a separate floor plan name, which different screens
 * read in different orders, so the same unit could carry two names at once.
 */

export const UNIT_NAME_MAX = 80;

/*
 * What landlords see. A row can be one apartment ("2W") or one floor plan that
 * many apartments share ("The Aspen"): a small walk-up wants the first, a
 * 44-unit building with four layouts wants the second, and one row per layout
 * keeps it from being listed as 44 near-identical units.
 */
export const UNIT_NAME_LABEL = "Floor plan / unit name";

// The single-row forms: one name per row.
export const UNIT_NAME_HELP =
  "Small building? Use the unit number, like 2W. Big building where many apartments share a layout? Use the floor plan name instead, like “The Aspen”, so one entry covers every apartment with that layout.";

// The add-listing card, which can create several rows from a list.
export const UNIT_NAMES_HELP =
  "Small building? List each unit, separated by commas: 1W, 1E, 2W, 2E. Each becomes its own listing. Big building with a few repeated layouts? Name the floor plan instead, like “The Aspen”, and add one card per floor plan rather than one per apartment.";

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

/*
 * The apartments one lease covers, as its description says them: "Apt 14C",
 * "Apts 07C, 11C". A floor plan is one unit, so this is where a building's
 * apartment numbers live.
 */
export function apartmentsLabel(apartments) {
  const list = [...new Set((apartments ?? []).map((a) => String(a ?? "").trim()).filter(Boolean))];
  if (!list.length) return null;
  return `${list.length === 1 ? "Apt" : "Apts"} ${list.join(", ")}`;
}
