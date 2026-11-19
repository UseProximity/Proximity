/*
 * Run with: npm test (from apps/web). The Marketing tab's arithmetic (PRD 7.6):
 * grouping, rates, funnel, self-reported cross-tab, data quality, staff exclusion.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  NONE, dataQuality, funnelOptions, funnelSteps, matchesFunnel, parseFunnelFilter,
  selfReportedCrossTab, sourceCampaignRows, totals, withoutStaff,
} from "./report.js";

const S = (id, source, medium, campaign, extra = {}) => ({ id, source, medium, campaign, link_id: null, classified_from: "utm", tags_cleaned: false, ...extra });
const O = (outcome, session, s, extra = {}) => ({ outcome, session_id: session, source: s.source, medium: s.medium, campaign: s.campaign, link_id: s.link_id ?? null, ...extra });

const ig1 = S("s1", "instagram", "paid-social", "2026-11-a");
const ig2 = S("s2", "instagram", "paid-social", "2026-11-b");
const ig3 = S("s3", "instagram", "paid-social", "2026-11-a");
const direct = S("s4", "direct", "none", null, { classified_from: "direct" });
const sessions = [ig1, ig2, ig3, direct];
const outcomes = [
  O("account_created", "s1", ig1),
  O("proxy_question", "s1", ig1),
  O("landlord_message", "s1", ig1), // two inquiries, one inquiring session
  O("tour_requested", "s2", ig2),
  O("application_started", "s2", ig2),
  O("guides_visit", "s4", direct),
  O("account_created", null, { source: "app", medium: "app", campaign: null }),
];

test("totals: counts, inquiry roll-up and rates", () => {
  const t = totals(sessions, outcomes);
  assert.equal(t.sessions, 4);
  assert.equal(t.accountsCreated, 2);
  assert.equal(t.inquiries, 3);
  assert.equal(t.proxyQuestions, 1);
  assert.equal(t.landlordMessages, 1);
  assert.equal(t.toursRequested, 1);
  assert.equal(t.guidesVisits, 1);
  assert.equal(t.accountRate, 2 / 4);
  assert.equal(t.inquiryRate, 2 / 4); // sessions s1 and s2, not 3 inquiries
  assert.equal(t.applicationRate, 1 / 4);
});

test("rates ignore sessions outside the period and are null with no sessions", () => {
  const t = totals([ig1], [O("proxy_question", "old-session", ig1)]);
  assert.equal(t.inquiries, 1);
  assert.equal(t.inquiryRate, 0);
  assert.equal(totals([], [O("account_created", null, ig1)]).accountRate, null);
});

test("source rows expand to campaigns; sessionless outcomes get their own row", () => {
  const rows = sourceCampaignRows(sessions, outcomes);
  assert.deepEqual(rows.map((r) => r.label), ["instagram / paid-social", "direct / none", "app / app"]);
  const ig = rows[0];
  assert.equal(ig.metrics.sessions, 3);
  assert.deepEqual(ig.children.map((c) => [c.label, c.metrics.sessions]), [["2026-11-a", 2], ["2026-11-b", 1]]);
  assert.equal(rows[1].children[0].label, NONE);
  assert.equal(rows[2].metrics.sessions, 0);
  assert.equal(rows[2].metrics.accountRate, null);
});

test("funnel filter parsing and matching", () => {
  assert.deepEqual(parseFunnelFilter("source:instagram"), { kind: "source", value: "instagram" });
  assert.deepEqual(parseFunnelFilter("campaign:2026-11-a"), { kind: "campaign", value: "2026-11-a" });
  assert.equal(parseFunnelFilter("medium:x"), null);
  assert.equal(parseFunnelFilter(""), null);
  assert.equal(matchesFunnel({ kind: "campaign", value: "2026-11-a" }, ig3), true);
  assert.equal(matchesFunnel({ kind: "campaign", value: NONE }, direct), true);
  assert.equal(matchesFunnel(null, direct), true);
});

test("funnel steps in order", () => {
  const steps = funnelSteps(totals(sessions, outcomes));
  assert.deepEqual(steps.map(([l]) => l), ["Sessions", "Accounts created", "Inquiries", "Applications started", "Applications submitted"]);
  assert.deepEqual(steps.map(([, n]) => n), [4, 2, 3, 1, 0]);
});

test("funnel options list sources and named campaigns by sessions", () => {
  const opts = funnelOptions(sessions);
  assert.equal(opts[0].value, "source:instagram");
  assert.ok(opts.some((o) => o.value === "campaign:2026-11-a"));
  assert.ok(!opts.some((o) => o.value === `campaign:${NONE}`));
});

test("self-reported vs attributed cross-tab", () => {
  const users = [
    { referral_source: "Social Media", signup_source: "instagram" },
    { referral_source: "Social Media", signup_source: "instagram" },
    { referral_source: "", signup_source: "direct" },
    { referral_source: "qr:flyer-name", signup_source: "qr" },
    { referral_source: "A Friend", signup_source: "sidechat" },
  ];
  const { columns, rows } = selfReportedCrossTab(users, 2);
  assert.deepEqual(columns, ["instagram", "direct", "other"]);
  assert.deepEqual(rows[0], ["Social Media", 2, 0, 0, 2]);
  assert.ok(rows.some((r) => r[0] === "(not answered)" && r[2] === 1));
  assert.ok(rows.some((r) => r[0] === "qr:flyer-name" && r[3] === 1));
});

test("data quality shares", () => {
  const q = dataQuality(
    [...sessions, S("s5", "google", "referral", null, { classified_from: "referrer", tags_cleaned: true })],
    outcomes
  );
  assert.equal(q.untaggedShare, 2 / 5);
  assert.equal(q.referrerOnlyShare, 1 / 5);
  assert.equal(q.taggedShare, 3 / 5);
  assert.equal(q.tagsCleaned, 1);
  assert.equal(q.outcomesWithoutSession, 1);
  assert.equal(dataQuality([], []).untaggedShare, null);
});

test("staff sessions and outcomes are left out, including pre-sign-in outcomes on their session", () => {
  const staffSession = S("staff-s", "google", "cpc", null, { user_id: "admin-1" });
  const result = withoutStaff(
    [...sessions, staffSession],
    [...outcomes, O("guides_visit", "staff-s", staffSession), O("landlord_message", "s1", ig1, { user_id: "admin-1" })],
    new Set(["admin-1"])
  );
  assert.equal(result.sessions.length, 4);
  assert.equal(result.outcomes.length, outcomes.length);
});
