/*
 * Weekly time buckets for /analytics. Weeks start on Monday (UTC) and are keyed by
 * that Monday's date ("2026-09-28"). A period is the last N weeks including the current,
 * partial one; the "previous" period is the N weeks before it, used for trend arrows.
 */

export const WEEK_OPTIONS = [4, 12, 26, 52];
export const DEFAULT_WEEKS = 12;

export function parseWeeks(value) {
  const n = Number(value);
  return WEEK_OPTIONS.includes(n) ? n : DEFAULT_WEEKS;
}

function startOfWeek(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d;
}

const dayString = (d) => d.toISOString().slice(0, 10);

export function weekKey(timestamp) {
  return dayString(startOfWeek(new Date(timestamp)));
}

export function buildPeriod(weeks, now = new Date()) {
  const current = startOfWeek(now);
  const keys = Array.from({ length: weeks }, (_, i) => {
    const d = new Date(current);
    d.setUTCDate(d.getUTCDate() - 7 * (weeks - 1 - i));
    return dayString(d);
  });
  const prevStart = new Date(`${keys[0]}T00:00:00Z`);
  prevStart.setUTCDate(prevStart.getUTCDate() - 7 * weeks);
  return {
    weeks,
    keys,
    start: `${keys[0]}T00:00:00Z`,
    prevStart: prevStart.toISOString(),
    today: dayString(now),
  };
}

// Compare as epoch ms: rows mix full timestamps and bare dates ("2026-09-28").
const ms = (ts) => (ts ? new Date(ts).getTime() : NaN);
const inPeriod = (period, ts) => ms(ts) >= ms(period.start);
const inPrevious = (period, ts) => ms(ts) >= ms(period.prevStart) && ms(ts) < ms(period.start);

/** Count rows per week. Returns an array aligned with period.keys. */
export function weeklyCounts(period, rows, field = "created_at", weight) {
  const index = new Map(period.keys.map((k, i) => [k, i]));
  const counts = period.keys.map(() => 0);
  for (const row of rows) {
    const ts = row[field];
    if (!inPeriod(period, ts)) continue;
    const i = index.get(weekKey(ts));
    if (i !== undefined) counts[i] += weight ? weight(row) : 1;
  }
  return counts;
}

/** Totals for the current and previous period, for a stat tile. */
export function periodTotals(period, rows, field = "created_at", weight) {
  let current = 0;
  let previous = 0;
  for (const row of rows) {
    const ts = row[field];
    const w = weight ? weight(row) : 1;
    if (inPeriod(period, ts)) current += w;
    else if (inPrevious(period, ts)) previous += w;
  }
  return { current, previous };
}

export const sum = (values) => values.reduce((a, b) => a + b, 0);
