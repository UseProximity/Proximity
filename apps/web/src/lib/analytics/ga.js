import { getGoogleAccessToken, serviceAccountConfigured } from "@/lib/google/serviceAccount";
import { weeklyCounts, periodTotals } from "@/lib/analytics/periods";

/*
 * Google Analytics 4 Data API reads for /analytics.
 *
 * GA only runs on the production site (layout.js loads the tag there and nowhere else),
 * so these numbers always describe useproximity.org, even when the page is opened on
 * staging or the sandbox.
 *
 * Env: GA4_PROPERTY_ID, the numeric property id (GA Admin > Property details), not the
 * "G-..." measurement id. Auth reuses the project service account, which must be added
 * as a Viewer on the GA property.
 */

const SCOPE = "https://www.googleapis.com/auth/analytics.readonly";

export function gaConfigured() {
  return Boolean(serviceAccountConfigured() && process.env.GA4_PROPERTY_ID);
}

let cachedToken = null; // { token, expiresAt }

async function accessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.token;
  const token = await getGoogleAccessToken(SCOPE);
  cachedToken = { token, expiresAt: Date.now() + 50 * 60 * 1000 };
  return token;
}

const RETRIES = 2;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Worth another try: a dropped connection ("fetch failed"), rate limiting, or a Google-side error.
const retryable = (status) => status === 429 || status >= 500;

async function runReport(body) {
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(
        `https://analyticsdata.googleapis.com/v1beta/properties/${process.env.GA4_PROPERTY_ID}:runReport`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${await accessToken()}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ limit: 100000, ...body }),
          cache: "no-store",
        }
      );
    } catch (err) {
      if (attempt < RETRIES) {
        await sleep(400 * (attempt + 1));
        continue;
      }
      throw err;
    }
    if (res.ok) return (await res.json()).rows ?? [];
    if (retryable(res.status) && attempt < RETRIES) {
      await sleep(400 * (attempt + 1));
      continue;
    }
    throw new Error(`GA report failed: ${res.status} ${await res.text()}`);
  }
}

const gaDate = (d) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
const dateRange = (from, to) => ({ startDate: from.slice(0, 10), endDate: to });

function dayBefore(ts) {
  const d = new Date(ts);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function eventFilter(eventNames) {
  return {
    filter: { fieldName: "eventName", inListFilter: { values: eventNames } },
  };
}

/** Unique users who fired each event in the current period: { [eventName]: users }. */
export async function gaEventUsers(period, eventNames) {
  const rows = await runReport({
    dateRanges: [dateRange(period.start, period.today)],
    dimensions: [{ name: "eventName" }],
    metrics: [{ name: "totalUsers" }],
    dimensionFilter: eventFilter(eventNames),
  });
  const users = Object.fromEntries(eventNames.map((e) => [e, 0]));
  for (const r of rows) users[r.dimensionValues[0].value] = Number(r.metricValues[0].value);
  return users;
}

/** Weekly sessions and page views, plus unique visitors for each period. */
export async function gaTraffic(period) {
  const [daily, current, previous] = await Promise.all([
    runReport({
      dateRanges: [dateRange(period.prevStart, period.today)],
      dimensions: [{ name: "date" }],
      metrics: [{ name: "sessions" }, { name: "screenPageViews" }],
    }),
    runReport({
      dateRanges: [dateRange(period.start, period.today)],
      metrics: [{ name: "totalUsers" }],
    }),
    runReport({
      dateRanges: [dateRange(period.prevStart, dayBefore(period.start))],
      metrics: [{ name: "totalUsers" }],
    }),
  ]);
  const rows = daily.map((r) => ({
    date: gaDate(r.dimensionValues[0].value),
    sessions: Number(r.metricValues[0].value),
    views: Number(r.metricValues[1].value),
  }));
  const usersOf = (report) => Number(report[0]?.metricValues[0].value ?? 0);
  return {
    sessions: weeklyCounts(period, rows, "date", (r) => r.sessions),
    pageViews: weeklyCounts(period, rows, "date", (r) => r.views),
    sessionTotals: periodTotals(period, rows, "date", (r) => r.sessions),
    pageViewTotals: periodTotals(period, rows, "date", (r) => r.views),
    visitors: { current: usersOf(current), previous: usersOf(previous) },
  };
}

/**
 * Break a metric down by one dimension for the current period: [[value, n]], largest first.
 * `dimension` is a GA API name: built-in ("deviceCategory", "sessionDefaultChannelGroup",
 * "landingPage") or a registered event parameter ("customEvent:stage").
 * `event` (or `events`) limits the report to those events, e.g. who opened matchmaking;
 * `match` adds one exact-value condition, e.g. { field: "customEvent:source", value: "matchmaking" }.
 */
export async function gaBreakdown(
  period,
  { dimension, event, events, match, metric = "totalUsers", limit = 15 }
) {
  const names = events ?? (event ? [event] : null);
  const filters = [
    ...(names ? [eventFilter(names)] : []),
    ...(match
      ? [{ filter: { fieldName: match.field, stringFilter: { matchType: "EXACT", value: match.value } } }]
      : []),
  ];
  const rows = await runReport({
    dateRanges: [dateRange(period.start, period.today)],
    dimensions: [{ name: dimension }],
    metrics: [{ name: metric }],
    ...(filters.length === 1 ? { dimensionFilter: filters[0] } : {}),
    ...(filters.length > 1 ? { dimensionFilter: { andGroup: { expressions: filters } } } : {}),
    orderBys: [{ metric: { metricName: metric }, desc: true }],
    limit,
  });
  // GA reports device categories in lowercase ("desktop"); show them as words.
  const label = (v) => (dimension === "deviceCategory" ? v.charAt(0).toUpperCase() + v.slice(1) : v);
  return rows.map((r) => [label(r.dimensionValues[0].value), Number(r.metricValues[0].value)]);
}

/**
 * Weekly page views and period visitors for pages under each path prefix.
 * { [prefix]: { weekly: number[], views: { current, previous }, visitors } }
 */
export async function gaPathViews(period, prefixes) {
  const pathFilter = {
    orGroup: {
      expressions: prefixes.map((p) => ({
        filter: { fieldName: "pagePath", stringFilter: { matchType: "BEGINS_WITH", value: p } },
      })),
    },
  };
  const [daily, visitors] = await Promise.all([
    runReport({
      dateRanges: [dateRange(period.prevStart, period.today)],
      dimensions: [{ name: "date" }, { name: "pagePath" }],
      metrics: [{ name: "screenPageViews" }],
      dimensionFilter: pathFilter,
    }),
    runReport({
      dateRanges: [dateRange(period.start, period.today)],
      dimensions: [{ name: "pagePath" }],
      metrics: [{ name: "totalUsers" }],
      dimensionFilter: pathFilter,
    }),
  ]);
  const prefixOf = (path) => prefixes.find((p) => path.startsWith(p));
  const byPrefix = Object.fromEntries(prefixes.map((p) => [p, []]));
  for (const r of daily) {
    const p = prefixOf(r.dimensionValues[1].value);
    if (p) byPrefix[p].push({ date: gaDate(r.dimensionValues[0].value), n: Number(r.metricValues[0].value) });
  }
  // Visitors per path are summed across a prefix's sub-paths, so one person who opened two
  // sub-pages counts twice. Fine for a "how many people reached this area" read.
  const visitorTotals = Object.fromEntries(prefixes.map((p) => [p, 0]));
  for (const r of visitors) {
    const p = prefixOf(r.dimensionValues[0].value);
    if (p) visitorTotals[p] += Number(r.metricValues[0].value);
  }
  const weight = (row) => row.n;
  return Object.fromEntries(
    prefixes.map((p) => [
      p,
      {
        weekly: weeklyCounts(period, byPrefix[p], "date", weight),
        views: periodTotals(period, byPrefix[p], "date", weight),
        visitors: visitorTotals[p],
      },
    ])
  );
}
