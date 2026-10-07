import { gaConfigured, gaEventUsers } from "@/lib/analytics/ga";

/*
 * Building blocks shared by every /analytics tab.
 *
 * A tab loader returns { blocks: [...] }. Each block is one titled sub-section:
 *
 *   {
 *     title, description?,
 *     tiles:         [{ label, current, previous?, format?: "number" | "percent" | "days" | "money", hint? }],
 *     trends:        [{ title, source, series: [{ label, values: number[] }] }],   one value per week
 *     distributions: [{ title, source, rows: [[label, count]], answered?, note? }],  bar chart + table
 *     tables:        [{ title, source, columns: [{ label, format? }], rows: [[...]] }],
 *                    (a cell may be { value, format } to override its column's format)
 *     notes:         [string],
 *   }
 *
 * Every field except title is optional. Loaders build blocks with block(), and wrap each
 * one in safeBlock() so one failing query (or a Google outage) blanks that block only.
 *
 * Totals and trends only: no names, emails, chat text or per-account rows leave lib/analytics.
 */

export const DB = "Database";
export const GA = "Google Analytics (live site)";
export const DAY = 24 * 60 * 60 * 1000;

// Custom GA dimensions (event parameters) were registered on this date; GA only reports
// them from then on, so breakdowns that use them say so.
export const GA_CUSTOM_DIMENSIONS_SINCE = "October 3, 2026";

/*
 * One source of truth per number, so the page never shows two different counts of the same
 * thing:
 *   - Totals (how many chats, reviews, lease checks, contacts) come from the database, which
 *     records every one.
 *   - Google Analytics is used only for what the database cannot see: steps that leave no row
 *     (opened matchmaking, clicked a recommendation) shown as drop-off between steps, where
 *     visitors come from, and site traffic. GA misses visitors who block tracking, so its
 *     counts run lower; a GA funnel is read as percentages, not as a second total.
 *   - Vercel Analytics receives the same events but is not read here: it counts visitors
 *     differently, and showing both would put two disagreeing numbers on one page.
 */
export const GA_FUNNEL_NOTE =
  "Funnels come from Google Analytics, which only sees visitors who allow tracking, so its counts run lower than the database totals. Read funnels as drop-off between steps; use the database numbers for totals.";

export function block(title, parts = {}) {
  return {
    title,
    description: parts.description,
    tiles: parts.tiles ?? [],
    trends: parts.trends ?? [],
    distributions: parts.distributions ?? [],
    tables: parts.tables ?? [],
    notes: parts.notes ?? [],
  };
}

/** Run a block builder; on failure return the block with an error flag instead of throwing. */
export async function safeBlock(title, build) {
  try {
    return await build();
  } catch (err) {
    console.error(`[analytics] block "${title}" failed:`, err?.message);
    return { ...block(title), error: true };
  }
}

/** A Google Analytics block: returns a "not connected / unreachable" note instead of failing. */
export async function gaBlock(title, build) {
  try {
    return await build();
  } catch (err) {
    return block(title, { notes: [gaNote(err)] });
  }
}

export function gaNote(err) {
  if (!gaConfigured()) {
    return "Google Analytics is not connected yet, so numbers from the live site are hidden.";
  }
  console.error("[analytics] GA read failed:", err?.message);
  return "Google Analytics could not be reached just now, so its numbers are hidden. The database numbers are unaffected.";
}

export const pct = (part, whole) => (whole ? part / whole : null);
export const average = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);

export function median(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// True when ts falls in [from, to). Compared as dates, not strings: timestamps come back with
// mixed precision and offsets.
export function within(ts, from, to) {
  if (!ts) return false;
  const t = new Date(ts).getTime();
  return t >= new Date(from).getTime() && (!to || t < new Date(to).getTime());
}

/**
 * Count values into [[label, count]] rows, largest first. `pick` may return a value, an
 * array of values (each counted), or null to skip the row.
 */
export function countValues(rows, pick, { order } = {}) {
  const counts = new Map();
  for (const row of rows) {
    const v = pick(row);
    for (const value of Array.isArray(v) ? v : [v]) {
      if (value === null || value === undefined || value === "") continue;
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }
  const entries = [...counts];
  if (order) {
    const rank = (label) => {
      const i = order.indexOf(label);
      return i === -1 ? order.length : i;
    };
    return entries.sort((a, b) => rank(a[0]) - rank(b[0]) || b[1] - a[1]);
  }
  return entries.sort((a, b) => b[1] - a[1]);
}

/**
 * GA funnel table: visitors who did each step. `sequential` adds "% of first step", which only
 * makes sense when every step follows the one before it; otherwise the table is plain counts.
 */
export async function gaStepsTable(period, title, steps, { sequential = true } = {}) {
  const users = await gaEventUsers(period, steps.map((s) => s.event));
  const first = users[steps[0].event];
  const columns = [{ label: "Step" }, { label: "Visitors", format: "number" }];
  if (sequential) columns.push({ label: "% of first step", format: "percent" });
  return {
    title,
    source: GA,
    columns,
    rows: steps.map((s) => {
      const row = [s.label, users[s.event]];
      if (sequential) row.push(pct(users[s.event], first));
      return row;
    }),
  };
}

/**
 * A distribution from a GA breakdown on a custom dimension. Rows GA reports as "(not set)"
 * are events from before the dimension existed, so they are dropped and the note says when
 * collection started.
 */
export function customDimensionDistribution(title, rows, labelFor = (v) => v) {
  const set = rows.filter(([v]) => v && v !== "(not set)");
  return {
    title,
    source: GA,
    rows: set.map(([v, n]) => [labelFor(v), n]),
    note: set.length
      ? `Collected since ${GA_CUSTOM_DIMENSIONS_SINCE}.`
      : `Collecting since ${GA_CUSTOM_DIMENSIONS_SINCE}; numbers appear here within a day or two of new activity.`,
  };
}
