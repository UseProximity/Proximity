/*
 * Listing recipes: how code reads a site's units with no model (sync
 * confidence ledger, stage 2; Wyatt 2026-11-20 and 11-24).
 *
 * At import (and when a recipe stops working) Haiku reads the site once.
 * Code then works out, from where that read's units sit in the page text,
 * how to find them again: which pages carry the units, and what the line
 * after a unit's name looks like, so a unit the site adds later is found
 * too. That is the recipe. Replaying it is plain code: find each unit's
 * block (its name to the next unit's name) and read the block with fixed
 * patterns (parseBlock). A recipe is saved only when its replay reproduces
 * the read it was made from, and it is kept per site and per platform, so a
 * second building on the same platform is read by code from its first day.
 *
 * Pure: text in, units out.
 */

import { isoDate, termList } from "./snapshot.js";

export const RECIPE_VERSION = 1;
const BLOCK_MAX = 1500;

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function nameRe(name) {
  const parts = String(name ?? "").split(/[^A-Za-z0-9]+/).filter(Boolean).map(escapeRe);
  return parts.length ? new RegExp(`(?<![A-Za-z0-9])${parts.join("[^A-Za-z0-9]{0,3}")}(?![A-Za-z0-9])`, "i") : null;
}
const norm = (s) => String(s ?? "").replace(/[^a-z0-9]/gi, "").toLowerCase();

// Money that is not a rent: deposits, fees, discounts.
const NOT_RENT_AFTER = /^\s*(?:\/\s*)?(?:deposit|fee|off\b|gift|credit|application|admin|pet|parking|security)/i;
const NOT_RENT_BEFORE = /(?:deposit|fee|save|gift card|credit|application|admin|pet rent|parking|security)\W{0,12}$/i;
const STARTING_BEFORE = /(?:starting\s+(?:at|from)|starts\s+at|from|as\s+low\s+as|rates?\s+from)\W{0,14}$/i;

/*
 * One unit's block of page text, read with fixed patterns.
 * Returns { bedrooms, bathrooms, area, available, offers: [{ rent,
 * rentIsExact, rentIsPerPerson, leaseTermMonths, availableFrom, availableNow }] }.
 */
export function parseBlock(text, today = new Date()) {
  const t = String(text ?? "");
  const studio = /\bstudio\b/i.test(t);
  const bedM = t.match(/(\d+)\s*(?:bed(?:room)?s?|br|bd)\b/i);
  const bathM = t.match(/(\d+(?:\.\d)?)\s*(?:bath(?:room)?s?|ba)\b/i);
  const areaM = t.match(/(\d{1,2},\d{3}|\d{3,5})\s*(?:sq\.?\s*ft\.?|sqft|sf\b|square\s+feet)/i);
  const bedrooms = bedM ? Number(bedM[1]) : studio ? 0 : null;
  const bathrooms = bathM ? Number(bathM[1]) : null;
  const area = areaM ? Number(areaM[1].replace(/,/g, "")) : null;

  const perPerson = /per\s+(?:person|bed(?:room)?)\b|\/\s*(?:person|bed)\b|private\s+bedroom|by\s+the\s+bed/i.test(t) ? true : null;
  const terms = termList([
    ...[...t.matchAll(/(\d{1,2})\s*-?\s*mo(?:nth)?s?\.?\s*(?:lease|term)/gi)].map((m) => Number(m[1])),
    ...[...t.matchAll(/(?:lease\s*term|term)s?\s*:?\s*(\d{1,2})\s*mo(?:nth)?s?/gi)].map((m) => Number(m[1])),
  ]);
  const now = /available\s*(?:on\s*:?\s*)?(?:now|today|immediately)|status:\s*available\s+now|move[- ]in\s+ready/i.test(t);
  const dateM = t.match(/availab(?:le|ility)\s*(?:on|from|starting|date)?\s*:?\s*((?:[A-Za-z]{3,9}\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s*\d{0,4})|(?:\d{1,2}\/\d{1,2}(?:\/\d{2,4})?))/i);
  const availableFrom = now ? null : isoDate(dateM?.[1]?.trim() ?? null, today);

  const rents = [];
  for (const m of t.matchAll(/\$\s?(\d{1,2},\d{3}|\d{3,5})(?:\.\d{2})?/g)) {
    const n = Number(m[1].replace(/,/g, ""));
    if (!(n >= 250 && n <= 20000)) continue;
    const before = t.slice(Math.max(0, m.index - 30), m.index);
    const after = t.slice(m.index + m[0].length, m.index + m[0].length + 28);
    if (NOT_RENT_AFTER.test(after) || NOT_RENT_BEFORE.test(before)) continue;
    // "$1,435 - $2,705" and "$995+" are ranges: the low end, not a price.
    const range = /^\s*(?:-|–|to)\s*\$/.test(after) || /^\s*\+/.test(after) || /\$\s?[\d,]+(?:\.\d{2})?\s*(?:-|–|to)\s*$/.test(before);
    if (/\$\s?[\d,]+(?:\.\d{2})?\s*(?:-|–|to)\s*$/.test(before)) continue; // the high end of a range
    const exact = !range && !STARTING_BEFORE.test(before);
    if (!rents.some((r) => r.rent === n)) rents.push({ rent: n, exact, range });
  }
  // "From $1,165 ... Only 1 Unit Available!": with one unit left, the starting
  // price is that unit's price (Wyatt, 2026-11-25, Union at the Grove BlakeS1).
  const onlyUnit = rents.length === 1 && !rents[0].exact && !rents[0].range && /(?<![\d,.])(?:only\s+)?(?:1|one)\s+(?:unit|apartment|home)\s+(?:is\s+)?(?:available|left)\b/i.test(t);
  if (onlyUnit) rents[0].exact = true;
  const waitlist = /wait\s*list|no\s+units\s+available|not\s+available|sold\s+out|fully\s+leased|occupied|unavailable/i.test(t);
  const offers = rents.slice(0, 12).map((r) => ({
    rent: r.rent,
    rentIsExact: r.exact,
    onlyUnit: onlyUnit || undefined,
    rentIsPerPerson: perPerson,
    leaseTermMonths: terms,
    availableFrom,
    availableNow: now,
    apartments: [],
  }));
  return { bedrooms, bathrooms, area, available: offers.length ? true : !waitlist, offers };
}

const LAYOUT_SHAPE = /studio|#\s*(?:bed|br|bd)|bed(?:room)?s?\b|\$#|# ?sq|starting at|from \$/;
const lines = (text) => String(text ?? "").split("\n");
/* A line's shape: digits and case set aside, so "1 Bed" and "2 Bed" are one shape. */
export const lineShape = (line) => String(line ?? "").trim().toLowerCase().replace(/[\d,.]+/g, "#").replace(/\s+/g, " ").slice(0, 40);

/*
 * Where a name sits: { page, index (char), line (number) } or null. Whole
 * name only. An occurrence with another unit's name on the line before or
 * after is an entry in a list of plans (a filter, a menu), and is passed
 * over for the next one. A name found only in such a list is returned when
 * working a recipe out (listOk) and not when replaying one: a plan named
 * only in a filter has no block of its own to read.
 *   others  Set of the other units' names, normalised
 */
function locate(pages, name, others = null, listOk = true) {
  const re = nameRe(name);
  if (!re) return null;
  let fallback = null;
  for (let p = 0; p < pages.length; p++) {
    const text = pages[p].text;
    const all = new RegExp(re.source, "gi");
    let m;
    while ((m = all.exec(text))) {
      const index = m.index + (m[0].length - m[0].replace(/^[^A-Za-z0-9]+/, "").length);
      const hit = { page: p, index, line: text.slice(0, index).split("\n").length - 1 };
      if (!others?.size) return hit;
      const start = text.lastIndexOf("\n", index) + 1;
      const prev = text.slice(text.lastIndexOf("\n", start - 2) + 1, Math.max(0, start - 1));
      const lineEnd = text.indexOf("\n", index);
      const next = lineEnd < 0 ? "" : text.slice(lineEnd + 1, (text.indexOf("\n", lineEnd + 1) + 1 || text.length + 1) - 1);
      if (!others.has(norm(prev)) && !others.has(norm(next))) return hit;
      fallback ??= hit;
    }
  }
  return listOk ? fallback : null;
}

const samePath = (a, b) => {
  try {
    const x = new URL(a);
    const y = new URL(b);
    return x.host.replace(/^www\./, "") === y.host.replace(/^www\./, "") && x.pathname.replace(/\/+$/, "") === y.pathname.replace(/\/+$/, "");
  } catch {
    return a === b;
  }
};

/*
 * Work out a recipe from one read.
 *   pages  [{ url, text }] the pages that read saw
 *   units  the read's units (names, offers)
 * Returns the recipe, or null when the units cannot be found in the text
 * (plans with no names; prices that live in a picture).
 */
export function induceRecipe({ pages, units }) {
  const named = (units ?? []).filter((u) => norm(u.name));
  if (!named.length) return induceLayoutRecipe({ pages, units });
  const namedSet = (skip) => new Set(named.filter((x) => norm(x.name) !== norm(skip)).map((x) => norm(x.name)));
  const spots = named.map((u) => ({ u, at: locate(pages ?? [], u.name, namedSet(u.name)) })).filter((s) => s.at);
  if (spots.length < Math.max(1, Math.ceil(named.length * 0.6))) return null;
  const used = [...new Set(spots.map((s) => s.at.page))].sort((a, b) => a - b);
  // The line after a unit's name, when most units share its shape: how a new unit is spotted.
  const shapes = new Map();
  let alone = 0;
  for (const s of spots) {
    const ls = lines(pages[s.at.page].text);
    const own = ls[s.at.line] ?? "";
    if (norm(own) === norm(s.u.name)) alone += 1;
    const shape = lineShape(ls[s.at.line + 1]);
    if (shape) shapes.set(shape, (shapes.get(shape) ?? 0) + 1);
  }
  // Only shapes that read like a layout or a price ("studio", "# bed", "starting at $#"),
  // each shared by several units, and together covering most of them.
  const good = [...shapes.entries()].filter(([shape, n]) => LAYOUT_SHAPE.test(shape) && n >= Math.max(2, spots.length * 0.1)).sort((a, b) => b[1] - a[1]).slice(0, 4);
  const covered = good.reduce((n, [, c]) => n + c, 0);
  const after = alone >= spots.length * 0.8 && covered >= Math.max(2, spots.length * 0.7) ? good.map(([shape]) => shape) : null;
  return {
    v: RECIPE_VERSION,
    kind: "named",
    pages: used.map((i) => pages[i].url),
    after,
    names: named.map((u) => u.name),
  };
}

// A layout line: "4 Beds | 2 Baths", "2 beds, 2 baths · 800 sqft", "Studio / 1 Bath".
const LAYOUT_LINE = /(?:\bstudio\b|\d+\s*(?:bed(?:room)?s?|br|bd)\b)[^\n]{0,24}\d+(?:\.\d)?\s*(?:bath(?:room)?s?|ba)\b/i;

/* Plans a site lists by size alone (The ICON): each layout line starts a block. */
function induceLayoutRecipe({ pages, units }) {
  if (!(units ?? []).length) return null;
  const hits = (pages ?? []).map((p, i) => ({ i, n: lines(p.text).filter((l) => LAYOUT_LINE.test(l)).length })).filter((h) => h.n > 0).sort((a, b) => b.n - a.n);
  if (!hits.length) return null;
  return { v: RECIPE_VERSION, kind: "layout", pages: [pages[hits[0].i].url], after: null, names: [] };
}

// Lines that look like a name by position but are page furniture.
const NOT_A_NAME = /^(?:view|see|apply|tour|schedule|contact|filters?|specials?|details|available|availability|floor\s*plans?|photos?|gallery|amenities|more|menu|home|options|rent|deposit|unit\s*#?|bedrooms?|bathrooms?|area|all|any|sort|map|share|save)\b/i;

/*
 * Read the units a recipe describes out of today's pages.
 *   known  names to look for besides the recipe's own (the listing's units)
 * Returns { units, found, missing: [names], added: [names] }.
 */
export function replayRecipe(recipe, pages, { known = [], today = new Date() } = {}) {
  const all = (pages ?? []).filter((p) => p?.text);
  const mine = all.filter((p) => (recipe?.pages ?? []).some((u) => samePath(u, p.url)));
  const use = mine.length ? mine : all;
  if (!recipe || !use.length) return { units: [], found: 0, missing: [...(recipe?.names ?? [])], added: [] };
  if (recipe.kind === "layout") return replayLayout(use, today);

  const names = [];
  const have = new Set();
  // A listing's unit called "Studio" or "1 Bedroom" is a layout word, found
  // all over any page; only the recipe's own names of that kind are looked for.
  const generic = (n) => /^(?:studio|\d+\s*(?:bed(?:room)?s?|br|bd)(?:\s*[\/,|]?\s*\d+(?:\.\d)?\s*(?:bath(?:room)?s?|ba))?)$/i.test(String(n).trim());
  for (const n of [...(recipe.names ?? []), ...known.filter((k) => !generic(k))]) {
    if (!norm(n) || have.has(norm(n))) continue;
    have.add(norm(n));
    names.push(n);
  }
  // Units the site has added: a short line followed by a line of the learned shape.
  const added = [];
  const afters = Array.isArray(recipe.after) ? recipe.after : recipe.after ? [recipe.after] : [];
  if (afters.length) {
    for (const p of use) {
      const ls = lines(p.text);
      for (let i = 0; i + 1 < ls.length; i++) {
        const line = ls[i].trim();
        if (!line || line.length > 40 || have.has(norm(line)) || !norm(line) || NOT_A_NAME.test(line) || /\$/.test(line)) continue;
        if (!afters.includes(lineShape(ls[i + 1]))) continue;
        have.add(norm(line));
        names.push(line);
        added.push(line);
      }
    }
  }
  const otherNames = (name) => new Set(names.filter((n) => norm(n) !== norm(name)).map(norm));
  const spots = names.map((name) => ({ name, at: locate(use, name, new Set(names.filter((n) => norm(n) !== norm(name)).map(norm)), false) }));
  const placed = spots.filter((s) => s.at).sort((a, b) => a.at.page - b.at.page || a.at.index - b.at.index);
  const units = placed.map((s, i) => {
    const text = use[s.at.page].text;
    // From the start of the name's own line to the next unit's name.
    const start = text.lastIndexOf("\n", s.at.index) + 1;
    let next = placed[i + 1] && placed[i + 1].at.page === s.at.page ? text.lastIndexOf("\n", placed[i + 1].at.index) + 1 : text.length;
    // A page can list its plans twice (Union at the Grove, the Hudson): the
    // next unit by position may be far below, past a second list whose prices
    // then landed on this unit (MarshB1 took six, 2026-11-25). So the block
    // also ends at the first later line that is another unit's name.
    const ownEnd = text.indexOf("\n", s.at.index);
    if (ownEnd >= 0) {
      let at = ownEnd + 1;
      for (const line of text.slice(at, Math.min(next, start + BLOCK_MAX)).split("\n")) {
        if (otherNames(s.name).has(norm(line))) { next = at; break; }
        at += line.length + 1;
      }
    }
    const block = text.slice(start, Math.max(start + s.name.length, Math.min(next, start + BLOCK_MAX)));
    return { name: s.name, ...parseBlock(block, today), photos: [], floorPlanImageUrl: null, fromModel: true, readBy: "recipe", source: "the website, read by its recipe", evidence: { url: use[s.at.page].url, text: block } };
  });
  const recipeNames = new Set((recipe.names ?? []).map(norm));
  return {
    units,
    found: placed.filter((s) => recipeNames.has(norm(s.name))).length,
    missing: spots.filter((s) => !s.at).map((s) => s.name),
    added,
  };
}

function replayLayout(pages, today) {
  const units = [];
  for (const p of pages) {
    const ls = lines(p.text);
    const starts = ls.map((l, i) => (LAYOUT_LINE.test(l) ? i : -1)).filter((i) => i >= 0);
    starts.forEach((s, k) => {
      const block = ls.slice(s, Math.min(starts[k + 1] ?? ls.length, s + 40)).join("\n").slice(0, BLOCK_MAX);
      const parsed = parseBlock(block, today);
      if (parsed.bedrooms == null) return;
      const twin = units.find((u) => u.bedrooms === parsed.bedrooms && u.bathrooms === parsed.bathrooms && u.area === parsed.area);
      if (twin) return;
      units.push({ name: null, ...parsed, photos: [], floorPlanImageUrl: null, fromModel: true, readBy: "pattern", source: "the website, read by pattern", evidence: { url: p.url, text: block } });
    });
  }
  return { units, found: units.length, missing: [], added: [] };
}

/*
 * How well a replay reproduces the read it was made from. Each of the read's
 * units must be found with the same lowest rent (when it has one) and the
 * same bedrooms (when both say).
 * Returns { ok, matched, total, diffs: [text] }.
 */
export function compareReads(replayed, truth) {
  const diffs = [];
  let matched = 0;
  const list = (truth ?? []).filter((u) => norm(u.name) || u.bedrooms != null);
  for (const t of list) {
    const r = norm(t.name)
      ? (replayed ?? []).find((u) => norm(u.name) === norm(t.name))
      : (replayed ?? []).find((u) => u.bedrooms === t.bedrooms && Number(u.bathrooms) === Number(t.bathrooms) && (!t.area || !u.area || Math.abs(u.area - t.area) <= 2));
    const label = t.name ?? `${t.bedrooms} bed plan`;
    if (!r) {
      diffs.push(`${label}: not found by code`);
      continue;
    }
    const low = (u) => Math.min(...(u.offers ?? []).map((o) => o.rent).filter((n) => n != null));
    const tr = low(t);
    const rr = low(r);
    if (Number.isFinite(tr) && tr !== rr) {
      diffs.push(`${label}: rent ${Number.isFinite(rr) ? `$${rr}` : "missing"} by code, $${tr} by the read`);
      continue;
    }
    if (t.bedrooms != null && r.bedrooms != null && Number(t.bedrooms) !== Number(r.bedrooms)) {
      diffs.push(`${label}: ${r.bedrooms} bed by code, ${t.bedrooms} by the read`);
      continue;
    }
    matched += 1;
  }
  return { ok: list.length > 0 && matched / list.length >= 0.9, matched, total: list.length, diffs };
}

/* A recipe that has stopped working: most of its units are no longer where it looks. */
export function recipeBroken(recipe, replay) {
  if (!recipe) return true;
  if (recipe.kind === "layout") return replay.units.length === 0;
  const total = (recipe.names ?? []).length;
  return total > 0 && replay.found < Math.max(1, Math.ceil(total * 0.5));
}

/*
 * The platform a site is built on, from its pages' HTML: the key platform
 * recipes are shared under. null for a site of its own.
 */
const PLATFORM_HINTS = [
  ["rentcafe", /rentcafe\.com|securecafe\.com|cdngeneral\.rentcafe/i],
  ["entrata", /entrata\.com|medialibrarycf\.entrata/i],
  ["appfolio", /appfolio\.com|appfolioim/i],
  ["rentfetch", /rent-?fetch|rentfetch/i],
  ["apartments247", /apartments247\.com/i],
  ["g5", /g5-?(?:cms|static|search)|getg5\.com/i],
  ["repli", /repli360|repli\.com/i],
  ["rentmanager", /rentmanager\.com|rmresident/i],
  ["buildium", /managebuilding\.com|buildium/i],
  ["doorloop", /doorloop\.com/i],
  ["rentvine", /rentvine\.com/i],
  ["showmojo", /showmojo\.com/i],
  ["tenantturner", /tenantturner\.com/i],
  ["knock", /knockrentals|knockcrm/i],
  ["jonah", /jonahdigital|jd-fp-/i],
  ["resman", /myresman\.com/i],
];
export function detectPlatform(pages) {
  try {
    const host = new URL(pages?.[0]?.url ?? "").hostname.replace(/^www\./, "");
    if (/(^|\.)zillow\.com$/.test(host)) return "zillow";
    if (/(^|\.)apartments\.com$/.test(host)) return "apartments.com";
    if (/(^|\.)furnishedfinder\.com$/.test(host)) return "furnishedfinder";
  } catch {
    // not a URL: fall through to the HTML hints
  }
  const html = (pages ?? []).map((p) => p.html ?? "").join("\n").slice(0, 2_000_000);
  for (const [key, re] of PLATFORM_HINTS) if (re.test(html)) return key;
  return null;
}

/*
 * Digging deeper (Wyatt, 2026-11-24): the links worth opening for units whose
 * price is missing or only a starting-at. A link that names the unit comes
 * first, then availability and pricing pages. Same site only; at most `max`.
 *   links  [{ url, text }]
 */
export function deeperLinks({ units, links, visited = new Set(), origin = null, max = 4 }) {
  const need = (units ?? []).filter((u) => u.available !== false && (!(u.offers ?? []).length || (u.offers ?? []).every((o) => o.rentIsExact === false)));
  if (!need.length) return [];
  const scored = [];
  for (const l of links ?? []) {
    if (!l?.url || visited.has(l.url)) continue;
    let host = null;
    try { host = new URL(l.url).host; } catch { continue; }
    if (origin && host.replace(/^www\./, "") !== origin.replace(/^www\./, "")) continue;
    const hay = `${l.url} ${l.text ?? ""}`.toLowerCase();
    if (/\.(?:pdf|jpe?g|png|webp|gif)(?:\?|$)|mailto:|tel:|#/.test(l.url)) continue;
    let score = 0;
    const unit = need.find((u) => norm(u.name).length >= 3 && norm(hay).includes(norm(u.name)));
    if (unit) score += 5;
    if (/availab/.test(hay)) score += 4;
    if (/pricing|rates|rent\b|lease-?terms/.test(hay)) score += 3;
    if (/floor-?plans?|units?\b|apartments?\b/.test(hay)) score += 2;
    if (/apply|contact|tour|schedule|gallery|photo|blog|neighborhood|amenit|login|portal|resident/.test(hay)) score -= 4;
    if (score >= 3) scored.push({ url: l.url, score, unit: unit?.name ?? null });
  }
  const seen = new Set();
  return scored.sort((a, b) => b.score - a.score).filter((x) => !seen.has(x.url) && seen.add(x.url)).slice(0, max);
}

/*
 * Lay a deeper page's exact prices over units that had none. A price is taken
 * only from a block that belongs to the unit: its name to the next other
 * unit's name, on any place the page names it. A page that lists every plan
 * in a filter (The Shelby's availability page) names each unit with no price
 * of its own, and reading on from there once gave all twenty units the first
 * price on the page (2026-11-25); so a price that lands on three or more
 * units from one page is thrown out. Mutates and returns the units.
 */
export function deepenUnits(units, pages, { today = new Date() } = {}) {
  const all = (units ?? []).map((u) => u.name).filter((n) => norm(n));
  const taken = [];
  for (const u of units ?? []) {
    if ((u.offers ?? []).some((o) => o.rentIsExact !== false) || !norm(u.name)) continue;
    const mine = nameRe(u.name);
    const others = all.filter((n) => norm(n) !== norm(u.name) && !mine.test(n)).map(nameRe).filter(Boolean);
    const otherNames = new Set(all.filter((n) => norm(n) !== norm(u.name)).map(norm));
    let found = null;
    for (const p of pages ?? []) {
      const re = new RegExp(mine.source, "gi");
      let m;
      while (!found && (m = re.exec(p.text))) {
        const start = p.text.lastIndexOf("\n", m.index) + 1;
        const after = m.index + m[0].length;
        // A name with another unit's name on the line before or after is an
        // entry in a list of plans (a filter, a menu), not the head of a block.
        const prev = p.text.slice(p.text.lastIndexOf("\n", start - 2) + 1, Math.max(0, start - 1));
        const lineEnd = p.text.indexOf("\n", after);
        const next = lineEnd < 0 ? "" : p.text.slice(lineEnd + 1, (p.text.indexOf("\n", lineEnd + 1) + 1 || p.text.length + 1) - 1);
        if (otherNames.has(norm(prev)) || otherNames.has(norm(next))) continue;
        let end = Math.min(p.text.length, after + 800);
        for (const o of others) {
          const hit = o.exec(p.text.slice(after, end));
          if (hit) end = Math.min(end, after + hit.index);
        }
        const block = p.text.slice(start, end);
        const exact = parseBlock(block, today).offers.filter((o) => o.rentIsExact);
        if (exact.length) found = { offers: exact, evidence: { url: p.url, text: block }, page: p.url };
      }
      if (found) break;
    }
    if (found) taken.push({ u, was: { offers: u.offers, available: u.available, evidence: u.evidence }, ...found });
  }
  // The same price on three or more units from one page is the page's, not theirs.
  const count = new Map();
  for (const t of taken) {
    const k = `${t.page}|${t.offers.map((o) => o.rent).join(",")}`;
    count.set(k, (count.get(k) ?? 0) + 1);
  }
  for (const t of taken) {
    if (count.get(`${t.page}|${t.offers.map((o) => o.rent).join(",")}`) >= 3) continue;
    t.u.offers = t.offers;
    t.u.available = true;
    t.u.evidence = t.evidence;
  }
  return units;
}
