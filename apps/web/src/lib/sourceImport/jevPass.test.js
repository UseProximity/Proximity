import { test } from "node:test";
import assert from "node:assert/strict";
import { jevPass } from "./jevPass.js";
import { shadowRows } from "./shadow.js";
import { collectEvidence, textHasAddress, findUnit } from "./evidence.js";

const NOW = Date.parse("2026-11-24T12:00:00Z");
const state = { title: "The Lofts", address: "6100 Delmar Blvd, St. Louis, MO", listing_units: [{ id: "u1", name: "Pershing", bedrooms: 2, bathrooms: 2, area: 900, unit_leases: [{ id: "l1", rent: 1500 }] }] };
const page = "The Lofts at 6100 Delmar Blvd. Floor plans: The Pershing 2 Bed / 2 Bath 900 sq ft $1,450/mo. Available now.";
const units = [{ key: "n:pershing", name: "Pershing", bedrooms: 2, bathrooms: 2, area: 900, offers: [{ rent: 1450, rentExact: true, dateStated: true }] }];
const snapshot = { trace: { reader: "generic" }, units, evidence: collectEvidence([{ url: "https://x.test/plans", text: page }], units) };
const change = { kind: "rent_change", unitKey: "n:pershing", unitId: "u1", leaseId: "l1", field: "rent", old: { rent: 1500 }, new: { rent: 1450 }, facts: { rentExact: true }, verdict: { apply: true } };
const learnings = { synced: new Map([["lease:l1", { rent: 1500 }]]) };
const rows = () => shadowRows({ changes: [change], snapshot: { ...snapshot, trace: { reader: "generic" } }, state, learnings, now: NOW });

const fakeAsk = (answers) => async (_text, questions) => ({
  answers: Object.fromEntries(questions.map((q) => [q.name, answers(q)])),
  costUsd: 0.00001,
  model: "typesafe-ai/jev-1.14.0",
});

test("evidence finds the unit's text and the address check sees it", () => {
  assert.ok(snapshot.evidence.units["n:pershing"].text.includes("$1,450"));
  assert.ok(textHasAddress(page, state.address));
  assert.ok(findUnit("Plan: PERSHING-2", { name: "Pershing 2" }) >= 0);
});

test("Jev confirming the rent sets read quality to its probability", async () => {
  const [r] = await jevPass({ rows: rows(), snapshot, state, on: true, ask: fakeAsk((q) => (q.type === "predicate" ? { type: "predicate", probability: 0.97 } : { type: "choice", choice: "exact", probabilities: [{ value: "exact", probability: 0.95 }] })) });
  assert.equal(r.jev.status, "ok");
  assert.equal(r.read_quality, 0.97);
  // A pattern-parser read (trust 0.6) can never move a rent alone (bar 0.75).
  assert.equal(r.ledger_apply, false);
});

test("Jev calling it a starting-at price caps it, so it does not replace an exact rent", async () => {
  const [r] = await jevPass({ rows: rows(), snapshot, state, on: true, ask: fakeAsk((q) => (q.type === "predicate" ? { type: "predicate", probability: 0.9 } : { type: "choice", choice: "starting_at", probabilities: [{ value: "exact", probability: 0.05 }, { value: "starting_at", probability: 0.95 }] })) });
  assert.equal(r.read_quality, 0.5);
  assert.equal(r.ledger_apply, false);
});

test("a failed Jev call leaves the change for the next read", async () => {
  const [r] = await jevPass({ rows: rows(), snapshot, state, on: true, ask: async () => { throw new Error("HTTP 500"); } });
  assert.equal(r.jev.status, "failed");
  assert.equal(r.ledger_apply, false);
});

test("the right-building question is only asked when code cannot find the address", async () => {
  let asked = [];
  const ask = async (text, qs) => { asked.push(...qs.map((q) => q.name)); return fakeAsk(() => ({ type: "predicate", probability: 0.9 }))(text, qs); };
  await jevPass({ rows: rows(), snapshot, state, on: true, ask });
  assert.ok(!asked.includes("building"));
  asked = [];
  await jevPass({ rows: rows(), snapshot, state: { ...state, address: "77 Other St" }, on: true, ask });
  assert.ok(asked.includes("building"));
});

test("with Jev off nothing changes", async () => {
  const before = rows();
  const after = await jevPass({ rows: before, snapshot, state, on: false });
  assert.equal(after, before);
});

test("a unit's window stops at the next unit, and IvaS1 is not found inside IvaS10", () => {
  const text = "IvaS10\nStudio\n$1,165 per month\n12mo lease\nView Details\nIvaS1\nStudio\nFrom\n$1,185 per month\nView Details\nIvaS2\nStudio\n$1,225 per month";
  const us = [{ key: "n:ivas10", name: "IvaS10", offers: [] }, { key: "n:ivas1", name: "IvaS1", offers: [] }, { key: "n:ivas2", name: "IvaS2", offers: [] }];
  const ev = collectEvidence([{ url: "u", text: text + " ".repeat(400) }], us);
  assert.ok(ev.units["n:ivas1"].text.includes("$1,185"));
  assert.ok(!ev.units["n:ivas10"].text.includes("From"));
});

test("a withdrawn unit no page names is gone by code, without asking Jev", async () => {
  const w = { kind: "lease_withdrawn", unitId: "u1", leaseId: "l1", field: "unavailable", old: false, new: true, facts: { fromModel: true }, verdict: { apply: true } };
  const snap = { trace: { reader: "generic" }, unitListComplete: true, units: [], evidence: collectEvidence([{ url: "u", text: "6100 Delmar Blvd. " + "Only the London plan is available today. ".repeat(10) }], [], state.address) };
  const scored = shadowRows({ changes: [w], snapshot: snap, state, learnings, priorRuns: new Map([[`lease_withdrawn||l1|unavailable|true`, 1]]), now: NOW });
  let asked = 0;
  const [r] = await jevPass({ rows: scored, snapshot: snap, state, on: true, ask: async () => { asked++; return { answers: {}, costUsd: 0, model: "m" }; } });
  assert.equal(asked, 0);
  assert.equal(r.jev.model, "code");
  assert.equal(r.read_quality, 1);
});
