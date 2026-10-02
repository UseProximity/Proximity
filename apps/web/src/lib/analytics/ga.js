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

async function runReport(body) {
  const res = await fetch(
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
  if (!res.ok) throw new Error(`GA report failed: ${res.status} ${await res.text()}`);
  return (await res.json()).rows ?? [];
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
