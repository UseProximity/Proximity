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

// Unpriced last, like everywhere else on the listing.
const byPrice = (a, b) => {
  if (a.rent == null && b.rent == null) return 0;
  if (a.rent == null) return 1;
  if (b.rent == null) return -1;
  return a.rent - b.rent;
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
