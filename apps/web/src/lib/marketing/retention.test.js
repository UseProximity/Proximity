/*
 * Run with: npm test (from apps/web). The 13-month retention cutoff (PRD
 * section 9).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { retentionCutoff } from "./retention.js";

test("13 calendar months back, same time of day", () => {
  assert.equal(retentionCutoff(new Date("2026-11-17T08:45:00Z")), "2025-10-17T08:45:00.000Z");
  assert.equal(retentionCutoff(new Date("2027-01-05T00:00:00Z")), "2025-12-05T00:00:00.000Z");
});

test("a day the earlier month lacks clamps to its last day", () => {
  // 31 March 2027 minus 13 months is February 2026 (28 days).
  assert.equal(retentionCutoff(new Date("2027-03-31T12:00:00Z")), "2026-02-28T12:00:00.000Z");
});
