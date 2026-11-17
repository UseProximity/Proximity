import { fetchAll, countRows } from "@/lib/analytics/db";
import { weeklyCounts } from "@/lib/analytics/periods";
import { DB, block, safeBlock } from "@/lib/analytics/blocks";
import { staffUserIds, unregisteredTags } from "@/lib/marketing/linksServer";
import {
  REPORT_COLUMNS,
  dataQuality,
  funnelOptions,
  funnelSteps,
  groupRows,
  matchesFunnel,
  parseFunnelFilter,
  selfReportedCrossTab,
  sourceCampaignRows,
  totals,
  withoutStaff,
} from "@/lib/marketing/report";

/*
 * Marketing: sessions and outcomes by source, campaign and campaign link (PRD
 * 7.6), from our own marketing_* tables. Admin and super activity is left out
 * of every number (edge case 11).
 *
 * Options (from the query string of the admin Analytics page):
 *   link    a campaign link id: every block is limited to that link's
 *           sessions and outcomes (the Campaign links page links here)
 *   funnel  "source:<value>" or "campaign:<value>" for the funnel block
 */

const ADMIN_ANALYTICS = "/dashboard/admin/analytics";
const LINKS_PAGE = "/dashboard/admin/marketing/links";
const SESSION_COLUMNS = "id, started_at, source, medium, campaign, link_id, classified_from, tags_cleaned, user_id";
const OUTCOME_COLUMNS = "id, session_id, user_id, outcome, tier, source, medium, campaign, link_id, occurred_at";

const GA_NOTE =
  "These numbers come from our own database, which records every visit whose browser ran the session beacon and every server-side outcome. Google Analytics and Google Ads count differently (only visitors who allow tracking, their own attribution rules), so their numbers will not match exactly. This tab is the reporting source of truth.";
const STAFF_NOTE = "Admin and super accounts are left out of every number on this tab.";

const ms = (ts) => new Date(ts).getTime();
const inCurrent = (period, ts) => ms(ts) >= ms(period.start);

async function loadRows(period, options) {
  const [staff, sessionsAll, outcomesAll, links, users] = await Promise.all([
    staffUserIds(),
    fetchAll("marketing_sessions", SESSION_COLUMNS, (q) => q.gte("started_at", period.prevStart)),
    fetchAll("marketing_outcomes", OUTCOME_COLUMNS, (q) => q.gte("occurred_at", period.prevStart)),
    fetchAll("marketing_links", "id, slug, name, status, source, campaign"),
    fetchAll("users", "id, created_at, referral_source, signup_source, signup_session_id", (q) =>
      q.gte("created_at", period.start).not("signup_source", "is", null)
    ),
  ]);
  let { sessions, outcomes } = withoutStaff(sessionsAll, outcomesAll, staff);
  let accounts = users.filter((u) => !staff.has(u.id));

  const link = options.link ? links.find((l) => l.id === options.link) ?? null : null;
  if (options.link) {
    const linkSessions = new Set(sessionsAll.filter((s) => s.link_id === options.link).map((s) => s.id));
    sessions = sessions.filter((s) => s.link_id === options.link);
    outcomes = outcomes.filter((o) => o.link_id === options.link);
    accounts = accounts.filter((u) => linkSessions.has(u.signup_session_id));
  }

  const split = (rows, field) => ({
    current: rows.filter((r) => inCurrent(period, r[field])),
    previous: rows.filter((r) => !inCurrent(period, r[field])),
  });
  return { sessions: split(sessions, "started_at"), outcomes: split(outcomes, "occurred_at"), links, link, accounts };
}

function atAGlance(period, data) {
  const now = totals(data.sessions.current, data.outcomes.current);
  const before = totals(data.sessions.previous, data.outcomes.previous);
  const qNow = dataQuality(data.sessions.current, data.outcomes.current);
  const qBefore = dataQuality(data.sessions.previous, data.outcomes.previous);
  const weekly = (outcomeNames) =>
    weeklyCounts(period, data.outcomes.current.filter((o) => outcomeNames.includes(o.outcome)), "occurred_at");
  return block("At a glance", {
    tiles: [
      { label: "Sessions", current: now.sessions, previous: before.sessions },
      { label: "Tagged sessions", current: qNow.taggedShare, previous: qBefore.taggedShare, format: "percent", hint: "Arrived through a campaign link, UTMs, a src tag or a Google Ads click." },
      { label: "Accounts created", current: now.accountsCreated, previous: before.accountsCreated },
      { label: "Inquiries", current: now.inquiries, previous: before.inquiries, hint: "Proxy questions, landlord messages and tour requests." },
      { label: "Applications started", current: now.applicationsStarted, previous: before.applicationsStarted },
    ],
    trends: [
      {
        title: "Sessions, accounts and inquiries per week",
        source: DB,
        series: [
          { label: "Sessions", values: weeklyCounts(period, data.sessions.current, "started_at") },
          { label: "Accounts created", values: weekly(["account_created"]) },
          { label: "Inquiries", values: weekly(["proxy_question", "landlord_message", "tour_requested"]) },
        ],
      },
    ],
    notes: [GA_NOTE, STAFF_NOTE],
  });
}

function bySourceAndCampaign(data) {
  return block("By source and campaign", {
    description:
      "One row per source and medium; open a row to see its campaigns. Click a column heading to sort. Outcomes count under the source of the session they happened in, or the account's signup source when there was no session (the mobile app shows as app).",
    pivots: [
      {
        title: "Sources and campaigns",
        source: DB,
        firstColumn: "Source / medium",
        columns: REPORT_COLUMNS,
        rows: sourceCampaignRows(data.sessions.current, data.outcomes.current),
      },
    ],
  });
}

function funnel(data, options) {
  const filter = parseFunnelFilter(options.funnel);
  const sessions = data.sessions.current.filter((s) => matchesFunnel(filter, s));
  const outcomes = data.outcomes.current.filter((o) => matchesFunnel(filter, o));
  const t = totals(sessions, outcomes);
  const steps = funnelSteps(t);
  const name = filter ? `${filter.kind === "source" ? "Source" : "Campaign"}: ${filter.value}` : "All sources";
  return block("Funnel by source", {
    description: "Pick a source or campaign above the tab to narrow the funnel. Each step counts outcomes in the period.",
    tables: [
      {
        title: `Funnel: ${name}`,
        source: DB,
        columns: [{ label: "Step" }, { label: "Count", format: "number" }, { label: "Per session", format: "percent" }],
        rows: steps.map(([label, n]) => [label, n, t.sessions ? n / t.sessions : null]),
      },
    ],
  });
}

function selfReported(data) {
  const { columns, rows } = selfReportedCrossTab(data.accounts);
  return block("Self-reported vs attributed", {
    description:
      "Accounts created in the period: what they told us (referral_source, rows) against where the visit actually came from (signup_source, columns). A sanity check in both directions.",
    tables: [
      {
        title: "referral_source by signup_source",
        source: DB,
        wide: true,
        columns: [{ label: "Self-reported" }, ...columns.map((c) => ({ label: c, format: "number" })), { label: "Total", format: "number" }],
        rows,
      },
    ],
  });
}

function byLink(period, data) {
  const grouped = new Map(
    groupRows(
      data.sessions.current.filter((s) => s.link_id),
      data.outcomes.current.filter((o) => o.link_id),
      (r) => r.link_id
    ).map((r) => [r.key, r.metrics])
  );
  const empty = totals([], []);
  const rows = data.links
    .filter((l) => (data.link ? l.id === data.link.id : l.status === "active" || grouped.has(l.id)))
    .map((l) => ({
      label: `${l.slug}${l.status === "archived" ? " (archived)" : ""}`,
      sublabel: l.name,
      href: `${ADMIN_ANALYTICS}?tab=marketing&weeks=${period.weeks}&link=${l.id}`,
      metrics: grouped.get(l.id) ?? empty,
    }))
    .sort((a, b) => b.metrics.sessions - a.metrics.sessions || a.label.localeCompare(b.label));
  return block("By campaign link", {
    description: "One row per registered campaign link, so one flyer or ad can be compared with another. Open a link to limit the whole tab to it.",
    pivots: [{ title: "Campaign links", source: DB, firstColumn: "Link", columns: REPORT_COLUMNS, rows }],
  });
}

async function dataQualityBlock(period, data) {
  const q = dataQuality(data.sessions.current, data.outcomes.current);
  const [rejectedNow, rejectedBefore, tags] = await Promise.all([
    countRows("marketing_outcome_rejections", (b) => b.gte("occurred_at", period.start)),
    countRows("marketing_outcome_rejections", (b) => b.gte("occurred_at", period.prevStart).lt("occurred_at", period.start)),
    data.link ? Promise.resolve([]) : unregisteredTags(period.start, data.links),
  ]);
  const day = (ts) => new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Chicago" });
  return block("Data quality", {
    tiles: [
      { label: "Untagged sessions", current: q.untaggedShare, format: "percent", hint: "Classified from the referrer or direct: no link, UTMs, src or gclid." },
      { label: "Referrer only", current: q.referrerOnlyShare, format: "percent", hint: "Untagged, but the referring site told us where they came from." },
      { label: "Tags cleaned or truncated", current: q.tagsCleaned, hint: "Sessions whose tags needed more than lowercasing to fit the convention." },
      { label: "Outcomes with no session", current: q.outcomesWithoutSession, hint: "Mobile app, an expired visit or a blocked beacon: credited through the account." },
      { label: "Duplicate outcomes rejected", current: rejectedNow, previous: rejectedBefore, hint: "Retries and double clicks refused by the dedupe key." },
    ],
    tables: data.link
      ? []
      : [
          {
            title: "Unregistered src tags seen",
            source: DB,
            columns: [{ label: "Tag" }, { label: "Sessions", format: "number" }, { label: "Last seen" }, { label: "" }],
            rows: tags
              .sort((a, b) => b.sessions - a.sessions)
              .map((t) => [t.tag, t.sessions, day(t.lastSeen), { value: "Register", href: `${LINKS_PAGE}?register=${encodeURIComponent(t.tag)}` }]),
          },
        ],
  });
}

export default async function loadMarketing(period, options = {}) {
  const data = await loadRows(period, options);
  const blocks = await Promise.all([
    safeBlock("At a glance", () => atAGlance(period, data)),
    safeBlock("By source and campaign", () => bySourceAndCampaign(data)),
    safeBlock("Funnel by source", () => funnel(data, options)),
    safeBlock("Self-reported vs attributed", () => selfReported(data)),
    safeBlock("By campaign link", () => byLink(period, data)),
    safeBlock("Data quality", () => dataQualityBlock(period, data)),
  ]);
  return {
    blocks,
    controls: {
      funnel: { value: options.funnel ?? "", options: funnelOptions(data.sessions.current) },
      link: data.link ? { id: data.link.id, slug: data.link.slug, name: data.link.name } : null,
    },
  };
}
