/*
 * Tour times, shared by the server and the browser (no server imports).
 * Everything is St. Louis time (America/Chicago): a weekly pattern is
 * weekday -> hour blocks, and a slot is the UTC instant of one such block
 * on a real date.
 */
export const TZ = "America/Chicago";
export const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
export const DAY_LABELS = { sun: "Sun", mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat" };
export const HOUR_MIN = 8;
export const HOUR_MAX = 19; // the 7pm block ends at 8pm
export const HOURS = Array.from({ length: HOUR_MAX - HOUR_MIN + 1 }, (_, i) => HOUR_MIN + i);
export const HORIZON_DAYS = 14;

export function chicagoParts(date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, hour12: false, weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return { weekday: get("weekday").toLowerCase().slice(0, 3), y: Number(get("year")), m: Number(get("month")), d: Number(get("day")), h: Number(get("hour")) % 24 };
}

/* The UTC instant of a Chicago wall-clock hour on a calendar day. */
export function chicagoToUtc(y, m, d, h) {
  let guess = new Date(Date.UTC(y, m - 1, d, h));
  for (let i = 0; i < 3; i++) {
    const p = chicagoParts(guess);
    const diff = (p.h - h) + (p.d - d) * 24;
    if (diff === 0) return guess;
    guess = new Date(guess.getTime() - diff * 3600 * 1000);
  }
  return guess;
}

export function hourLabel(h) {
  const x = h % 12 === 0 ? 12 : h % 12;
  return `${x} ${h < 12 ? "AM" : "PM"}`;
}

export function fmtSlot(iso, { withDate = true } = {}) {
  const date = new Date(iso);
  const opts = withDate
    ? { timeZone: TZ, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }
    : { timeZone: TZ, hour: "numeric", minute: "2-digit" };
  return date.toLocaleString("en-US", opts).replace(",", "");
}

export function fmtDay(iso) {
  return new Date(iso).toLocaleDateString("en-US", { timeZone: TZ, weekday: "long", month: "short", day: "numeric" });
}

/* Day key (YYYY-MM-DD in Chicago) for grouping slots. */
export function dayKey(iso) {
  const p = chicagoParts(new Date(iso));
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

export function normalizePattern(input) {
  const out = {};
  for (const day of DAYS) {
    const hours = Array.isArray(input?.[day]) ? input[day] : [];
    const clean = [...new Set(hours.map(Number).filter((h) => Number.isInteger(h) && h >= HOUR_MIN && h <= HOUR_MAX))].sort((a, b) => a - b);
    if (clean.length) out[day] = clean;
  }
  return out;
}

/* The next HORIZON_DAYS calendar days as { key, y, m, d, weekday, label }. */
export function upcomingDays({ from = new Date(), days = HORIZON_DAYS } = {}) {
  const start = chicagoParts(from);
  const out = [];
  for (let i = 1; i <= days; i++) {
    const day = new Date(Date.UTC(start.y, start.m - 1, start.d + i, 12));
    const p = chicagoParts(day);
    out.push({ key: `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`, y: p.y, m: p.m, d: p.d, weekday: p.weekday, label: day.toLocaleDateString("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric" }) });
  }
  return out;
}

/* Real-date slots for the next HORIZON_DAYS that match the weekly pattern. */
export function slotsFromPattern(pattern, { from = new Date(), days = HORIZON_DAYS } = {}) {
  const clean = normalizePattern(pattern);
  const out = [];
  for (const day of upcomingDays({ from, days })) {
    for (const h of clean[day.weekday] ?? []) {
      const at = chicagoToUtc(day.y, day.m, day.d, h);
      if (at.getTime() > from.getTime() + 3600 * 1000) out.push(at.toISOString());
    }
  }
  return out;
}
