/*
 * Pairing a read's units with the listing's units (lib/sourceImport/apply.js
 * plans changes from these pairs). Pure, relative imports only, so node --test
 * can load it.
 */

export const norm = (s) => String(s ?? "").replace(/[^a-z0-9]/gi, "").toLowerCase();
// The same words in any order: a leasing portal's "Highland - A3" is the
// listing's "A3-Highland" (Mansions on the Plaza, 2026-11-11).
const words = (s) => String(s ?? "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).sort().join(" ");
export const sameName = (a, b) => !!norm(a) && (norm(a) === norm(b) || words(a) === words(b));

const tokens = (s) => String(s ?? "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
/*
 * One name is the other plus words of the place: the listing's "302" is the
 * website's "7350 Lindell Blvd. -302" (Wyatt, 2026-11-25: the two sat side by
 * side as separate units). place is the listing's address and title.
 */
export function nameWithin(a, b, place = "") {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.length || !tb.length || ta.length === tb.length) return false;
  const [short, long] = ta.length < tb.length ? [ta, tb] : [tb, ta];
  if (!short.every((t) => long.includes(t))) return false;
  const placeTokens = new Set(tokens(place));
  return long.filter((t) => !short.includes(t)).every((t) => placeTokens.has(t));
}
// A unit named for its layout alone: "Studio", "1 Bedroom", "2 Bed / 2 Bath".
export const genericName = (n) => /^(?:studio|\d+\s*(?:bed(?:room)?s?|br|bd)(?:\s*[\/,|]?\s*\d+(?:\.\d)?\s*(?:bath(?:room)?s?|ba))?)$/i.test(String(n ?? "").trim());

/*
 * Pair the snapshot's units with the listing's. Name first; then, among units
 * of the same layout, the closest size within 5%; then the only unit of that
 * layout on each side. Returns [{ snap, db }] with db null for new units, plus
 * the listing's units nothing claimed.
 */
export function matchUnits(snapUnits, dbUnits, { place = "" } = {}) {
  const pool = dbUnits.map((u) => ({ u, used: false }));
  /*
   * Names first, across every plan, then layout for what is left. One plan
   * at a time, 212 Clayton's "09" (781 sq ft) came before "12" and took the
   * listing's existing "12" (786 sq ft) by size; the real 12 then looked new.
   */
  const byName = new Map();
  // A unit read off its own page (listing_unit_pages) already knows which
  // unit it is.
  for (const s of snapUnits) {
    if (!s.pinnedUnitId) continue;
    const hit = pool.find((p) => !p.used && p.u.id === s.pinnedUnitId);
    if (hit) {
      hit.used = true;
      byName.set(s, hit.u);
    }
  }
  for (const s of snapUnits) {
    if (byName.has(s) || s.pinnedUnitId) continue;
    const hit = norm(s.name) ? pool.find((p) => !p.used && sameName(p.u.name, s.name)) : null;
    if (hit) {
      hit.used = true;
      byName.set(s, hit.u);
    }
  }
  // Then a plan's other name, kept when two sources' names for it were merged (read.js dedupeLayouts).
  for (const s of snapUnits) {
    if (byName.has(s) || s.pinnedUnitId || !(s.aka ?? []).length) continue;
    const hit = pool.find((p) => !p.used && s.aka.some((a) => sameName(p.u.name, a)));
    if (hit) {
      hit.used = true;
      byName.set(s, hit.u);
    }
  }
  // Then a name that is the other plus the address, when one unit only fits.
  const sameLayout = (p, s) => (s.bedrooms == null || Number(p.u.bedrooms) === Number(s.bedrooms)) && (s.bathrooms == null || Number(p.u.bathrooms) === Number(s.bathrooms));
  for (const s of snapUnits) {
    if (byName.has(s) || s.pinnedUnitId || !norm(s.name) || !place) continue;
    const fits = pool.filter((p) => !p.used && nameWithin(p.u.name, s.name, place) && sameLayout(p, s));
    if (fits.length === 1) {
      fits[0].used = true;
      byName.set(s, fits[0].u);
    }
  }
  const pairs = [];
  for (const s of snapUnits) {
    if (byName.has(s)) {
      pairs.push({ snap: s, db: byName.get(s) });
      continue;
    }
    // Pinned to a unit that is no longer on the listing: nothing to do.
    if (s.pinnedUnitId) continue;
    const sName = norm(s.name);
    let hit = null;
    if (s.bedrooms != null && s.bathrooms != null) {
      const same = pool.filter((p) => !p.used && Number(p.u.bedrooms) === Number(s.bedrooms) && Number(p.u.bathrooms) === Number(s.bathrooms));
      const gap = (p) => (Number(p.u.area) > 0 && s.area > 0 ? Math.abs(Number(p.u.area) - s.area) / Math.max(Number(p.u.area), s.area) : Infinity);
      hit = same.filter((p) => gap(p) <= 0.05).sort((a, b) => gap(a) - gap(b))[0] ?? null;
      if (!hit) {
        const onlyOne =
          same.length === 1 &&
          snapUnits.filter((x) => Number(x.bedrooms) === Number(s.bedrooms) && Number(x.bathrooms) === Number(s.bathrooms)).length === 1;
        // Only when neither side has a name to disagree on.
        if (onlyOne && !sName && !norm(same[0].u.name)) hit = same[0];
      }
    }
    if (hit) hit.used = true;
    pairs.push({ snap: s, db: hit?.u ?? null });
  }
  return { pairs, unmatched: pool.filter((p) => !p.used).map((p) => p.u) };
}

/*
 * The website keys to save as a unit's id mapping (Wyatt, 2026-11-24: no unit
 * may be duplicated for want of one): every website unit matched to a listing
 * unit by name, or by its own page, that has no mapping to that unit yet. A
 * layout-only match is a guess and is never saved. Pure.
 */
export function nameMatchAliases(snapUnits, dbUnits, aliases = new Map()) {
  const keys = new Map();
  for (const s of snapUnits ?? []) if (s.key) keys.set(s.key, (keys.get(s.key) ?? 0) + 1);
  const { pairs } = matchUnits(snapUnits ?? [], dbUnits ?? []);
  const out = [];
  for (const { snap, db } of pairs) {
    if (!db || !snap.key || keys.get(snap.key) !== 1 || !snap.key.startsWith("n:")) continue;
    if (aliases.get(snap.key) === db.id) continue;
    if (snap.pinnedUnitId !== db.id && !sameName(snap.name, db.name)) continue;
    out.push({ kind: "unit_alias", source_key: snap.key, unit_id: db.id, value: { siteName: snap.name ?? null, unitName: db.name ?? null }, learned_from: "name_match" });
  }
  return out;
}


/*
 * Of two names for one plan, the one a person would say: a word ("London",
 * "Pershing") over a code ("A012", "B.22"). Ties keep the first.
 */
export function naturalName(a, b) {
  const score = (n) => {
    const s = String(n ?? "").trim();
    if (!s) return -5;
    const words = s.split(/[^A-Za-z]+/).filter((w) => w.length >= 4 && !/^(unit|plan|floor|floorplan|apartment|bedroom|bath|studio)$/i.test(w));
    return (words.length ? 2 : 0) - (/\d/.test(s) ? 1 : 0) - (/^[A-Za-z]{0,2}[.\-]?\d+[A-Za-z]?$/.test(s) ? 2 : 0);
  };
  return score(b) > score(a) ? b : a;
}

/* JSON with object keys in order: stored JSON comes back reordered, so equal values compare equal. */
export function stableJson(value) {
  const sort = (v) => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => [k, sort(v[k])]));
    return v;
  };
  return JSON.stringify(sort(value ?? null));
}
