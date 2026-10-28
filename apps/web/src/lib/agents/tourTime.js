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

/* ---- availability as ranges (Wyatt, 2026-10-27, round 6) --------------- */

const shortHour = (h, min = 0) => {
  const x = h % 12 === 0 ? 12 : h % 12;
  return `${x}${min ? `:${String(min).padStart(2, "0")}` : ""}${h < 12 || h === 24 ? "am" : "pm"}`;
};

/*
 * One-hour slots grouped into days of contiguous ranges:
 * [{ key, weekday, label: "Sunday 10/28", ranges: [{ startH, endH }] }].
 * A slot at hour h covers h to h+1.
 */
export function availabilityDays(slots) {
  const byDay = new Map();
  for (const iso of [...(slots ?? [])].sort()) {
    const p = chicagoParts(new Date(iso));
    const key = `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
    if (!byDay.has(key)) {
      const label = new Date(iso).toLocaleDateString("en-US", { timeZone: TZ, weekday: "long" }) + ` ${p.m}/${p.d}`;
      byDay.set(key, { key, y: p.y, m: p.m, d: p.d, weekday: p.weekday, label, hours: [] });
    }
    byDay.get(key).hours.push(p.h);
  }
  return [...byDay.values()].map((day) => {
    const hours = [...new Set(day.hours)].sort((a, b) => a - b);
    const ranges = [];
    for (const h of hours) {
      const last = ranges[ranges.length - 1];
      if (last && last.endH === h) last.endH = h + 1;
      else ranges.push({ startH: h, endH: h + 1 });
    }
    return { key: day.key, y: day.y, m: day.m, d: day.d, weekday: day.weekday, label: day.label, ranges };
  });
}

/* "Sunday 10/28 8am-2pm, 3pm-4pm" one line per day. */
export function availabilityText(slots) {
  return availabilityDays(slots)
    .map((d) => `${d.label} ${d.ranges.map((r) => `${shortHour(r.startH)}-${shortHour(r.endH)}`).join(", ")}`)
    .join("\n");
}

/* "2 day availability" for the chip in the chat input. */
export function availabilitySummary(slots) {
  const n = availabilityDays(slots).length;
  return n ? `${n} day availability` : "";
}

/* "Sunday 10/28 at 2:30pm" for one instant. */
export function fmtTourTime(iso) {
  const date = new Date(iso);
  const p = chicagoParts(date);
  const min = Number(new Intl.DateTimeFormat("en-US", { timeZone: TZ, minute: "2-digit" }).format(date));
  const day = date.toLocaleDateString("en-US", { timeZone: TZ, weekday: "long" });
  return `${day} ${p.m}/${p.d} at ${shortHour(p.h, min)}`;
}

/*
 * A landlord's chosen start time on one of the student's days: "HH:MM"
 * (24h, from <input type="time">). Valid when it falls inside one of that
 * day's ranges and at least 10 minutes before the range ends. Returns
 * { iso } or { error }.
 */
export function checkTourTime(slots, dayKeyValue, hhmm) {
  const day = availabilityDays(slots).find((d) => d.key === dayKeyValue);
  if (!day) return { error: "Pick one of the days the student offered." };
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm ?? "").trim());
  if (!m) return { error: "Enter a time like 2:30 PM." };
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return { error: "Enter a time like 2:30 PM." };
  const t = h * 60 + min;
  const fits = day.ranges.find((r) => t >= r.startH * 60 && t <= r.endH * 60 - 10);
  if (!fits) {
    const text = day.ranges.map((r) => `${shortHour(r.startH)}-${shortHour(r.endH)}`).join(", ");
    return { error: `That's outside the student's times on ${day.label} (${text}). Pick a start at least 10 minutes before a window ends.` };
  }
  const iso = new Date(chicagoToUtc(day.y, day.m, day.d, h).getTime() + min * 60000).toISOString();
  if (Date.parse(iso) < Date.now()) return { error: "That time has already passed." };
  return { iso };
}
