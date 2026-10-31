/*
 * Does an offering fit the student's move-in month and lease length?
 *
 * A student picks two things once (when they want to move in, and for how
 * long) and every unit's lease options open already narrowed to them. This
 * matters most at properties fed by a management system, which publish one
 * offering per apartment, per start date, per term, each priced separately: a
 * single unit can carry dozens. Two answers collapse that to the few rows that
 * are actually about this student.
 *
 * Preferences: { moveIn: "YYYY-MM-01" | null, months: number | null }.
 *
 * Rules, per axis:
 *   - Move-in: a lease fits when it starts on or before the last day of the
 *     chosen month. A start already in the past reads as "Now" and fits any
 *     month from this one on. A move-in month that has itself passed is treated
 *     as this month, never as "nothing fits".
 *   - Length: a lease fits when lease_term_months contains the chosen number.
 *     The array is every term the landlord will write, so [10, 12] fits both.
 *   - A lease that never stated a date or a term is UNKNOWN on that axis, not a
 *     miss: an unstated date is not a late one. Unknowns stay with the fits but
 *     rank after the exact ones.
 *
 * Dates are compared as "YYYY-MM-DD" strings, the same way utils/availability
 * does, so the viewer's timezone can never move a day.
 *
 * Pure on purpose: no React, no fetch. leaseFit.test.js covers it.
 */

export const todayISO = () => new Date().toISOString().slice(0, 10);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const pad = (n) => String(n).padStart(2, "0");

// "2026-11-17" or "2026-11" -> "2026-11-01". Anything else -> null.
export function normalizeMoveIn(value) {
  const m = /^(\d{4})-(\d{2})(?:-\d{2})?$/.exec(String(value ?? "").trim());
  if (!m) return null;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return `${m[1]}-${m[2]}-01`;
}

// 0 (a studio) to 20 bedrooms, or null.
export function normalizeBeds(value) {
  if (value === "" || value == null) return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= 20 ? n : null;
}

// 0 -> "studio", 2 -> "2 bed".
export const bedsLabel = (n) => (n === 0 ? "studio" : `${n} bed`);

// A whole number of months between 1 and 60, or null.
export function normalizeMonths(value) {
  if (value === "" || value == null) return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 60 ? n : null;
}

// "2026-11-01" -> "Nov 2026".
export function moveInLabel(moveIn) {
  const iso = normalizeMoveIn(moveIn);
  if (!iso) return null;
  return `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
}

export const monthsLabel = (n) => (n === 1 ? "1 month" : `${n} months`);

// Last calendar day of the month that starts on `firstOfMonth`.
function endOfMonth(firstOfMonth) {
  const y = Number(firstOfMonth.slice(0, 4));
  const m = Number(firstOfMonth.slice(5, 7));
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${firstOfMonth.slice(0, 8)}${pad(last)}`;
}

// True when the chosen move-in month ended before today.
export function moveInHasPassed(moveIn, today = todayISO()) {
  const iso = normalizeMoveIn(moveIn);
  return !!iso && endOfMonth(iso) < today;
}

/*
 * The month picker's choices: this month and the next 23. A saved month that
 * has since passed is kept at the top so the select can still show it.
 */
export function moveInOptions(today = todayISO(), saved = null) {
  let y = Number(today.slice(0, 4));
  let m = Number(today.slice(5, 7));
  const out = [];
  for (let i = 0; i < 24; i++) {
    const value = `${y}-${pad(m)}-01`;
    out.push({ value, label: moveInLabel(value) });
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  const s = normalizeMoveIn(saved);
  if (s && !out.some((o) => o.value === s)) {
    out.unshift({ value: s, label: `${moveInLabel(s)} (passed)` });
  }
  return out;
}

// The length picker's choices: 1 to 24 months, plus a saved length past 24.
export function leaseMonthOptions(saved = null) {
  const hint = { 10: " (academic year)", 12: " (full year)" };
  const out = [];
  for (let n = 1; n <= 24; n++) out.push({ value: n, label: `${monthsLabel(n)}${hint[n] ?? ""}` });
  const s = normalizeMonths(saved);
  if (s && s > 24) out.push({ value: s, label: monthsLabel(s) });
  return out;
}

/*
 * The pickers on one unit offer only what that unit has: the months its leases
 * start in and the lengths they are written for (Wyatt, 2026-10-27). A start
 * already past counts as this month.
 */
export function unitMoveInOptions(leases, today = todayISO()) {
  const thisMonth = `${today.slice(0, 7)}-01`;
  const months = new Set();
  let started = false;
  for (const l of leases ?? []) {
    if (!l?.availableFrom) continue;
    const m = normalizeMoveIn(String(l.availableFrom).slice(0, 7));
    if (!m) continue;
    months.add(m < thisMonth ? thisMonth : m);
    if (String(l.availableFrom).slice(0, 10) <= today) started = true;
  }
  // A lease that has already started is available "Now", not "Oct 2026" (Wyatt, 2026-10-31).
  return [...months]
    .sort()
    .map((value) => ({ value, label: started && value === thisMonth ? "Now" : moveInLabel(value) }));
}

export function unitLeaseMonthOptions(leases) {
  const hint = { 10: " (academic year)", 12: " (full year)" };
  return [...new Set((leases ?? []).flatMap(termsOf))]
    .sort((a, b) => a - b)
    .map((n) => ({ value: n, label: `${monthsLabel(n)}${hint[n] ?? ""}` }));
}

/*
 * The student's saved answers as they apply to one unit. A saved month or
 * length the unit does not offer is dropped for that unit, so its picker reads
 * "Any" and the list is not narrowed on that axis (Wyatt, 2026-10-27). The
 * saved value itself is untouched and still applies on units that offer it.
 */
export function prefsForUnit(prefs, leases, today = todayISO()) {
  const moveIn = normalizeMoveIn(prefs?.moveIn);
  const months = normalizeMonths(prefs?.months);
  return {
    moveIn: moveIn && unitMoveInOptions(leases, today).some((o) => o.value === moveIn) ? moveIn : null,
    months: months && unitLeaseMonthOptions(leases).some((o) => o.value === months) ? months : null,
  };
}

export const prefsActive = (prefs) => !!(normalizeMoveIn(prefs?.moveIn) || normalizeMonths(prefs?.months));

const termsOf = (lease) =>
  [...new Set((lease?.leaseTermMonths ?? []).map(Number).filter((m) => Number.isFinite(m) && m > 0))].sort(
    (a, b) => a - b
  );

const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

/*
 * How one lease stands against the preferences.
 * Returns { date, term, kind, dateDays, termGap }:
 *   date / term  "fit" | "unknown" | "miss" | "none" (no preference on that axis)
 *   kind         "exact" (every stated axis fits), "unknown" (nothing misses,
 *                something is unstated) or "miss"
 *   dateDays     for a date miss, how many days after the move-in month it starts
 *   termGap      for a term miss, months to the nearest term on offer
 */
export function leaseFit(lease, prefs, today = todayISO()) {
  const moveIn = normalizeMoveIn(prefs?.moveIn);
  const months = normalizeMonths(prefs?.months);

  let date = "none";
  let dateDays = 0;
  if (moveIn) {
    const from = lease?.availableFrom ? String(lease.availableFrom).slice(0, 10) : null;
    if (!from) {
      date = "unknown";
    } else {
      // A passed month means "as soon as possible", which is this month.
      const deadline = moveInHasPassed(moveIn, today) ? endOfMonth(`${today.slice(0, 7)}-01`) : endOfMonth(moveIn);
      const start = from < today ? today : from;
      if (start <= deadline) {
        date = "fit";
      } else {
        date = "miss";
        dateDays = daysBetween(deadline, start);
      }
    }
  }

  let term = "none";
  let termGap = 0;
  if (months) {
    const terms = termsOf(lease);
    if (!terms.length) term = "unknown";
    else if (terms.includes(months)) term = "fit";
    else {
      term = "miss";
      termGap = Math.min(...terms.map((t) => Math.abs(t - months)));
    }
  }

  const axes = [date, term];
  const kind = axes.includes("miss") ? "miss" : axes.includes("unknown") ? "unknown" : "exact";
  return { date, term, kind, dateDays, termGap };
}

const KIND_RANK = { exact: 0, unknown: 1, miss: 2 };

/*
 * The rent leases are ranked on: the whole apartment's monthly rent
 * (unitRent, worked out server-side in shapeLeases), so a $900/person 4 bed
 * ($3,600) does not rank as cheaper than a $1,600 2 bed. The price a renter
 * sees is still the one the landlord set. Falls back to the stated rent.
 */
export const sortRent = (lease) => lease?.unitRent ?? lease?.rent ?? null;

// Unpriced last, like everywhere else on the listing.
const byPrice = (a, b) => {
  const ra = sortRent(a);
  const rb = sortRent(b);
  if (ra == null && rb == null) return 0;
  if (ra == null) return 1;
  if (rb == null) return -1;
  return ra - rb;
};

/*
 * Order for two leases under the preferences: exact fits, then fits with an
 * unknown, then misses closest first (fewest axes missed, then the nearest
 * term, then the nearest start). Price breaks every tie. With no preferences
 * this is plain cheapest-first, which is what the list did before.
 */
export function compareLeases(a, b, prefs, today = todayISO()) {
  if (!prefsActive(prefs)) return byPrice(a, b);
  const fa = leaseFit(a, prefs, today);
  const fb = leaseFit(b, prefs, today);
  if (fa.kind !== fb.kind) return KIND_RANK[fa.kind] - KIND_RANK[fb.kind];
  if (fa.kind === "miss") {
    const missesA = (fa.date === "miss") + (fa.term === "miss");
    const missesB = (fb.date === "miss") + (fb.term === "miss");
    if (missesA !== missesB) return missesA - missesB;
    if (fa.termGap !== fb.termGap) return fa.termGap - fb.termGap;
    if (fa.dateDays !== fb.dateDays) return fa.dateDays - fb.dateDays;
  }
  return byPrice(a, b);
}

const shortDate = (iso) =>
  new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

// One muted line under a row that does not fit, saying why.
export function missReason(lease, prefs, today = todayISO()) {
  const f = leaseFit(lease, prefs, today);
  const parts = [];
  if (f.date === "miss") parts.push(`Starts ${shortDate(String(lease.availableFrom))}, after your move-in`);
  if (f.term === "miss") parts.push(`No ${normalizeMonths(prefs.months)}-month option`);
  return parts.join(". ") || null;
}

/*
 * Split one unit's leases for display.
 *
 * Returns { active, fits, misses, note }:
 *   fits    exact fits then fits with an unknown, each cheapest first
 *   misses  everything else, closest first
 *   note    set only when nothing fits: why, in a sentence. The caller then
 *           shows the misses straight away, so a unit never looks empty just
 *           because the student's dates are narrow.
 */
export function partitionLeases(leases, prefs, today = todayISO()) {
  const list = [...(leases ?? [])];
  const cmp = (a, b) => compareLeases(a, b, prefs, today);

  if (!prefsActive(prefs)) {
    return { active: false, fits: stableSort(list, cmp), misses: [], note: null };
  }

  const fits = [];
  const misses = [];
  for (const l of list) (leaseFit(l, prefs, today).kind === "miss" ? misses : fits).push(l);

  let note = null;
  if (!fits.length && misses.length) {
    const months = normalizeMonths(prefs.months);
    const reasons = [];
    if (months) {
      const offered = [...new Set(list.flatMap(termsOf))].sort((a, b) => a - b);
      if (offered.length && !offered.includes(months)) {
        reasons.push(`No ${months}-month lease on this unit`);
      }
    }
    if (normalizeMoveIn(prefs.moveIn)) {
      const starts = list
        .map((l) => (l.availableFrom ? String(l.availableFrom).slice(0, 10) : null))
        .filter(Boolean)
        .map((d) => (d < today ? today : d))
        .sort();
      if (starts.length && misses.every((l) => leaseFit(l, prefs, today).date === "miss")) {
        reasons.push(`The earliest start here is ${shortDate(starts[0])}`);
      }
    }
    note = `${reasons.length ? reasons.join(". ") : "Nothing here matches both your move-in and lease length"}. Showing the closest options.`;
  }

  return { active: true, fits: stableSort(fits, cmp), misses: stableSort(misses, cmp), note };
}

// Ties keep arrival order (which is cheapest first from the server).
export function stableSort(items, compare) {
  return items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => compare(a.item, b.item) || a.i - b.i)
    .map(({ item }) => item);
}

/*
 * The whole listing at once (Wyatt, 2026-10-30). The unit tabs are gone: a
 * student says "I want a [beds] for [length] starting [month]" and sees every
 * matching lease, grouped by floor plan.
 *
 * Preferences here carry a third axis, beds: { beds, moveIn, months }.
 *
 *   - Each dropdown offers only what exists at this listing given the other two
 *     picks, so a pick can never lead to an empty list.
 *   - The saved picks apply in order beds, then length, then move-in. A saved
 *     pick that would leave nothing here (no 3 bed at all, or no 12 month 2
 *     bed) reads "Any" on this listing; the saved value itself is untouched.
 *   - Unstated dates and lengths still fit, ranked after exact ones, as above.
 */

/*
 * Every lease on the listing, with the unit it belongs to. A unit with no
 * bedroom count is unknown on beds, not a studio: it is never offered as a
 * size, and it stays in the list whatever size is picked, like an unstated
 * date or length.
 */
export function listingOfferings(units) {
  return (units ?? []).flatMap((unit) =>
    (unit?.leases ?? []).map((lease) => ({ lease, unit, beds: unit.bedrooms ?? null }))
  );
}

// A passed month means "as soon as possible", which is this month.
function liveMoveIn(moveIn, today) {
  const iso = normalizeMoveIn(moveIn);
  if (!iso) return null;
  return moveInHasPassed(iso, today) ? `${today.slice(0, 7)}-01` : iso;
}

function offeringFits(o, prefs, today) {
  const beds = normalizeBeds(prefs?.beds);
  if (beds != null && o.beds != null && o.beds !== beds) return false;
  return leaseFit(o.lease, prefs, today).kind !== "miss";
}

// The values each dropdown may offer, given the other two picks.
export function listingChoices(offerings, prefs, today = todayISO()) {
  const p = { beds: normalizeBeds(prefs?.beds), moveIn: liveMoveIn(prefs?.moveIn, today), months: normalizeMonths(prefs?.months) };
  const where = (patch) => offerings.filter((o) => offeringFits(o, { ...p, ...patch }, today));
  return {
    beds: [...new Set(where({ beds: null }).map((o) => o.beds).filter((n) => n != null))]
      .sort((a, b) => a - b)
      .map((n) => ({ value: n, label: bedsLabel(n) })),
    // Plain lengths: the "(full year)" hints make the sentence's select too wide.
    months: unitLeaseMonthOptions(where({ months: null }).map((o) => o.lease)).map((o) => ({
      value: o.value,
      label: monthsLabel(o.value),
    })),
    moveIn: unitMoveInOptions(where({ moveIn: null }).map((o) => o.lease), today),
  };
}

// The saved picks as they apply to this listing, in priority order.
export function listingPrefs(offerings, saved, today = todayISO()) {
  const has = (opts, v) => v != null && opts.some((o) => o.value === v);
  let beds = normalizeBeds(saved?.beds);
  beds = has(listingChoices(offerings, {}, today).beds, beds) ? beds : null;
  let months = normalizeMonths(saved?.months);
  months = has(listingChoices(offerings, { beds }, today).months, months) ? months : null;
  /*
   * A lease fits a move-in month when it starts by the end of it, so a saved
   * Sep fits leases starting in Aug. When no lease starts in the saved month
   * itself, the latest start month before it shows the same leases and is the
   * one the dropdown can say.
   */
  let moveIn = liveMoveIn(saved?.moveIn, today);
  const starts = listingChoices(offerings, { beds, months }, today).moveIn;
  moveIn = moveIn ? starts.filter((o) => o.value <= moveIn).at(-1)?.value ?? null : null;
  return { beds, moveIn, months };
}

/*
 * The matching leases, one entry per floor plan that has any, in the order the
 * units were given (the landlord's). Inside a plan: exact fits, then fits with
 * an unknown, cheapest first.
 */
export function listingMatches(offerings, prefs, today = todayISO()) {
  const byUnit = new Map();
  for (const o of offerings) {
    if (!offeringFits(o, prefs, today)) continue;
    if (!byUnit.has(o.unit)) byUnit.set(o.unit, []);
    byUnit.get(o.unit).push(o.lease);
  }
  return [...byUnit.entries()].map(([unit, leases]) => ({
    unit,
    leases: stableSort(leases, (a, b) => compareLeases(a, b, prefs, today)),
  }));
}

/*
 * "Sort by" on a listing (Wyatt, 2026-10-31). Best match is the order above.
 * Price sorts leases by rent (whole-apartment, see sortRent), then floor plans
 * by their first lease; size sorts floor plans by square feet. Unpriced leases
 * and unmeasured plans go last either way.
 */
export const LEASE_SORTS = [
  { value: "match", label: "Best match" },
  { value: "price-asc", label: "Price: low to high" },
  { value: "price-desc", label: "Price: high to low" },
  { value: "area-desc", label: "Sq ft: largest" },
  { value: "area-asc", label: "Sq ft: smallest" },
];

const lastIfNull = (a, b, dir) => {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return dir * (a - b);
};

const planArea = (p) => (p.unit?.area == null ? null : Number(p.unit.area));

// A floor plan's place under a sort: its first lease's rent, or its size.
const PLAN_KEYS = {
  "price-asc": { dir: 1, key: (p) => sortRent(p.leases[0]) },
  "price-desc": { dir: -1, key: (p) => sortRent(p.leases[0]) },
  "area-desc": { dir: -1, key: planArea },
  "area-asc": { dir: 1, key: planArea },
};

// [{unit, leases}] from listingMatches, put in the chosen order.
export function sortPlans(plans, sort) {
  const s = PLAN_KEYS[sort];
  if (!s) return plans;
  const sorted = sort.startsWith("price")
    ? plans.map((p) => ({ ...p, leases: stableSort(p.leases, (a, b) => lastIfNull(sortRent(a), sortRent(b), s.dir)) }))
    : plans;
  return stableSort(sorted, (a, b) => lastIfNull(s.key(a), s.key(b), s.dir));
}

/*
 * Landlords under a sort other than Best match (Wyatt, 2026-10-31): each
 * landlord's own plans and leases in the sort's order, and the landlords by
 * their best plan, so on "Price: low to high" whoever has the cheapest lease
 * comes first with everything of theirs, then the next. `groups` are
 * [{ plans: [{unit, leases}] }]; ties keep the order given.
 */
export function sortLandlords(groups, sort) {
  const s = PLAN_KEYS[sort];
  if (!s) return groups;
  const sorted = groups.map((g) => ({ ...g, plans: sortPlans(g.plans, sort) }));
  return stableSort(sorted, (a, b) => lastIfNull(s.key(a.plans[0]), s.key(b.plans[0]), s.dir));
}
