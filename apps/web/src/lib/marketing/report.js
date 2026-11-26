/*
 * The Marketing tab's arithmetic (PRD 7.6), kept pure so it can be tested:
 * grouping sessions and outcomes into report rows, the rates, the funnel, the
 * self-reported vs attributed cross-tab and the data quality shares.
 *
 * Inputs are rows the loader already limited to the period and stripped of
 * staff (admin and super) activity:
 *   sessions  { id, source, medium, campaign, link_id, classified_from, tags_cleaned, started_at }
 *   outcomes  { session_id, outcome, tier, source, medium, campaign, link_id, occurred_at }
 *
 * An outcome is grouped by the labels it was recorded with (a snapshot of its
 * session, or of the account for sessionless outcomes), so an app signup with
 * no session still lands in an "app" row.
 *
 * Pure; no "@/" imports (Node test runner loads it).
 */

export const NONE = "(none)";

// Outcome name -> metric key in a report row. Inquiries also roll up into "inquiries".
const OUTCOME_METRIC = {
  account_created: "accountsCreated",
  account_activated: "accountsActivated",
  proxy_question: "proxyQuestions",
  landlord_message: "landlordMessages",
  tour_requested: "toursRequested",
  application_started: "applicationsStarted",
  application_submitted: "applicationsSubmitted",
  waitlist_click: "waitlistClicks",
  review_submitted: "reviews",
  lease_check_completed: "leaseChecksCompleted",
  guides_visit: "guidesVisits",
  hub_visit: "hubVisits",
};

const INQUIRIES = new Set(["proxy_question", "landlord_message", "tour_requested"]);

/** The main table's columns, in PRD order (key, label, format). */
export const REPORT_COLUMNS = [
  { key: "sessions", label: "Sessions" },
  { key: "accountsCreated", label: "Accounts created" },
  { key: "accountsActivated", label: "Accounts activated" },
  { key: "inquiries", label: "Inquiries" },
  { key: "proxyQuestions", label: "Proxy questions" },
  { key: "landlordMessages", label: "Landlord messages" },
  { key: "toursRequested", label: "Tours requested" },
  { key: "applicationsStarted", label: "Applications started" },
  { key: "applicationsSubmitted", label: "Applications submitted" },
  { key: "waitlistClicks", label: "Waitlist clicks" },
  { key: "reviews", label: "Reviews" },
  { key: "leaseChecksCompleted", label: "Lease checks completed" },
  { key: "guidesVisits", label: "Guides visits" },
  { key: "hubVisits", label: "Hub visits" },
  { key: "accountRate", label: "Account rate", format: "percent" },
  { key: "inquiryRate", label: "Inquiry rate", format: "percent" },
  { key: "applicationRate", label: "Application rate", format: "percent" },
];

export const TAGGED_FROM = new Set(["link", "utm", "src", "gclid"]);

const label = (v) => (v === null || v === undefined || v === "" ? NONE : String(v));

function emptyMetrics() {
  const m = { sessions: 0, inquiries: 0 };
  for (const key of Object.values(OUTCOME_METRIC)) m[key] = 0;
  m._sessionIds = new Set();
  m._inquirySessions = new Set();
  m._applicationSessions = new Set();
  return m;
}

function addSession(m, s) {
  m.sessions += 1;
  m._sessionIds.add(s.id);
}

function addOutcome(m, o) {
  const key = OUTCOME_METRIC[o.outcome];
  if (key) m[key] += 1;
  if (INQUIRIES.has(o.outcome)) {
    m.inquiries += 1;
    if (o.session_id) m._inquirySessions.add(o.session_id);
  }
  if (o.outcome === "application_started" && o.session_id) m._applicationSessions.add(o.session_id);
}

/*
 * Rates use this period's sessions only: an inquiry on a session that started
 * before the period counts as an inquiry, but not toward the inquiry rate, so
 * a rate can never pass 100%.
 */
function finish(m) {
  const within = (set) => [...set].filter((id) => m._sessionIds.has(id)).length;
  const rate = (n) => (m.sessions ? n / m.sessions : null);
  const out = { ...m };
  out.accountRate = rate(m.accountsCreated);
  out.inquiryRate = rate(within(m._inquirySessions));
  out.applicationRate = rate(within(m._applicationSessions));
  delete out._sessionIds;
  delete out._inquirySessions;
  delete out._applicationSessions;
  return out;
}

/** Totals over everything passed in (one report row). */
export function totals(sessions, outcomes) {
  const m = emptyMetrics();
  for (const s of sessions) addSession(m, s);
  for (const o of outcomes) addOutcome(m, o);
  return finish(m);
}

/**
 * Rows grouped by `keyOf(row)` (applied to sessions and outcomes alike),
 * sorted by sessions then accounts, descending. Each row: { key, metrics }.
 */
export function groupRows(sessions, outcomes, keyOf) {
  const groups = new Map();
  const get = (k) => {
    if (!groups.has(k)) groups.set(k, emptyMetrics());
    return groups.get(k);
  };
  for (const s of sessions) addSession(get(keyOf(s)), s);
  for (const o of outcomes) addOutcome(get(keyOf(o)), o);
  return [...groups.entries()]
    .map(([key, m]) => ({ key, metrics: finish(m) }))
    .sort((a, b) => b.metrics.sessions - a.metrics.sessions || b.metrics.accountsCreated - a.metrics.accountsCreated || String(a.key).localeCompare(String(b.key)));
}

/**
 * The main table: one row per source / medium, expandable to its campaigns.
 * [{ label, metrics, children: [{ label, metrics }] }]
 */
export function sourceCampaignRows(sessions, outcomes) {
  const sourceKey = (r) => `${label(r.source)} / ${label(r.medium)}`;
  return groupRows(sessions, outcomes, sourceKey).map((row) => {
    const inSource = (r) => sourceKey(r) === row.key;
    const children = groupRows(sessions.filter(inSource), outcomes.filter(inSource), (r) => label(r.campaign));
    return { label: row.key, metrics: row.metrics, children: children.map((c) => ({ label: c.key, metrics: c.metrics })) };
  });
}

/** Funnel steps for one slice (sessions -> accounts -> inquiries -> applications). */
export function funnelSteps(metrics) {
  return [
    ["Sessions", metrics.sessions],
    ["Accounts created", metrics.accountsCreated],
    ["Inquiries", metrics.inquiries],
    ["Applications started", metrics.applicationsStarted],
    ["Applications submitted", metrics.applicationsSubmitted],
  ];
}

/**
 * Parse the funnel picker's value ("source:instagram" or "campaign:2026-11-x").
 * Returns { kind, value } or null for "all".
 */
export function parseFunnelFilter(raw) {
  const m = /^(source|campaign):(.{1,80})$/.exec(String(raw ?? ""));
  return m ? { kind: m[1], value: m[2] } : null;
}

export function matchesFunnel(filter, row) {
  if (!filter) return true;
  return label(row[filter.kind]) === filter.value;
}

/** The funnel picker's options: every source and campaign seen, most sessions first. */
export function funnelOptions(sessions) {
  const count = (field) => {
    const c = new Map();
    for (const s of sessions) c.set(label(s[field]), (c.get(label(s[field])) ?? 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  };
  return [
    ...count("source").map(([v, n]) => ({ value: `source:${v}`, label: `Source: ${v} (${n})` })),
    ...count("campaign").filter(([v]) => v !== NONE).map(([v, n]) => ({ value: `campaign:${v}`, label: `Campaign: ${v} (${n})` })),
  ];
}

/*
 * The self-reported answer as it reads in the cross-tab. Empty answers are
 * "(not answered)"; system tags written into referral_source by older code
 * (qr:<tag>, Waitlist, payer_invite, ...) are kept as they are, so the table
 * shows exactly what the column holds.
 */
export function selfReportedLabel(value) {
  const v = String(value ?? "").trim();
  return v ? v.slice(0, 60) : "(not answered)";
}

/**
 * Cross-tab of referral_source (rows) against signup_source (columns) for
 * accounts created in the period. The most common signup sources get their
 * own column (up to maxColumns), the rest go into "other".
 * Returns { columns: [string], rows: [[label, ...counts, total]] }.
 */
export function selfReportedCrossTab(users, maxColumns = 6) {
  const bySource = new Map();
  for (const u of users) bySource.set(label(u.signup_source), (bySource.get(label(u.signup_source)) ?? 0) + 1);
  const ranked = [...bySource.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([s]) => s);
  const shown = ranked.slice(0, maxColumns);
  const hasOther = ranked.length > shown.length;
  const columns = hasOther ? [...shown, "other"] : shown;
  const rows = new Map();
  for (const u of users) {
    const r = selfReportedLabel(u.referral_source);
    if (!rows.has(r)) rows.set(r, new Array(columns.length).fill(0));
    const s = label(u.signup_source);
    const i = shown.includes(s) ? shown.indexOf(s) : columns.length - 1;
    rows.get(r)[i] += 1;
  }
  return {
    columns,
    rows: [...rows.entries()]
      .map(([r, counts]) => [r, ...counts, counts.reduce((a, b) => a + b, 0)])
      .sort((a, b) => b[b.length - 1] - a[a.length - 1] || String(a[0]).localeCompare(String(b[0]))),
  };
}

/** Data quality shares over the period's sessions and outcomes. */
export function dataQuality(sessions, outcomes) {
  const n = sessions.length;
  const share = (count) => (n ? count / n : null);
  return {
    sessions: n,
    untaggedShare: share(sessions.filter((s) => !TAGGED_FROM.has(s.classified_from)).length),
    referrerOnlyShare: share(sessions.filter((s) => s.classified_from === "referrer").length),
    taggedShare: share(sessions.filter((s) => TAGGED_FROM.has(s.classified_from)).length),
    tagsCleaned: sessions.filter((s) => s.tags_cleaned).length,
    outcomesWithoutSession: outcomes.filter((o) => !o.session_id).length,
  };
}

/**
 * Staff exclusion (PRD edge case 11): drop sessions that belong to an admin or
 * super account, and outcomes recorded by one or on one of their sessions
 * (an outcome from before they signed in has no user id but sits on their session).
 */
export function withoutStaff(sessions, outcomes, staffIds) {
  const staffSessions = new Set(sessions.filter((s) => s.user_id && staffIds.has(s.user_id)).map((s) => s.id));
  return {
    sessions: sessions.filter((s) => !staffSessions.has(s.id)),
    outcomes: outcomes.filter((o) => !(o.user_id && staffIds.has(o.user_id)) && !(o.session_id && staffSessions.has(o.session_id))),
    staffSessions,
  };
}
