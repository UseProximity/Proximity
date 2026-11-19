/*
 * Run with: npm test (from apps/web). Old /analytics addresses land on the matching admin
 * Analytics tab (PRD 7.6, edge case 25).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { analyticsRedirectTarget } from "./redirect.js";

test("/analytics/<tab> keeps its tab and period", () => {
  assert.equal(analyticsRedirectTarget("reviews", { weeks: "26" }), "/dashboard/admin/analytics?tab=reviews&weeks=26");
  assert.equal(analyticsRedirectTarget("lease-check", {}), "/dashboard/admin/analytics?tab=lease-check");
});

test("/analytics and unknown tabs open the first tab", () => {
  assert.equal(analyticsRedirectTarget(null, undefined), "/dashboard/admin/analytics?tab=overview");
  assert.equal(analyticsRedirectTarget("nope", { weeks: "12" }), "/dashboard/admin/analytics?tab=overview&weeks=12");
});

test("only a plain number is carried as the period", () => {
  assert.equal(analyticsRedirectTarget("traffic", { weeks: "4&x=1" }), "/dashboard/admin/analytics?tab=traffic");
  assert.equal(analyticsRedirectTarget("traffic", { weeks: ["52", "4"] }), "/dashboard/admin/analytics?tab=traffic&weeks=52");
});
