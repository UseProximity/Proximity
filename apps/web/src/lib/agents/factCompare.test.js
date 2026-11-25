// node --test apps/web/src/lib/agents/factCompare.test.js
// Relative imports: node --test does not know the @/ alias.
import test from "node:test";
import assert from "node:assert/strict";
import { numbersOf, numbersWithin, carriesChange, decideGroup, mergeDuplicateGroups } from "./factCompare.js";

const fact = (summary, extra = {}) => ({ id: extra.id ?? "f1", section: "misc", field_key: "misc.office-hours", scope_level: "property", scope_id: null, summary, value: {}, valid_until: null, source_id: "contact", ...extra });
const prop = (summary, extra = {}) => ({ section: "misc", key: "misc.office-hours", scopeLevel: "property", scopeId: null, summary, value: {}, validUntil: null, sourceId: "footer", ...extra });

test("times, ordinals, number words and dates are compared however they are written", () => {
  assert.equal(numbersOf("Open 9am to 6pm"), numbersOf("Open 9:00 AM to 6:00 PM"));
  assert.equal(numbersOf("Open 9 to 6pm"), numbersOf("Open 9 a.m. to 6 p.m."));
  assert.equal(numbersOf("Rent is due on the 1st"), numbersOf("Rent is due on the first"));
  assert.equal(numbersOf("A twenty-four hour gym"), numbersOf("A 24-hour gym"));
  assert.equal(numbersOf("Move in 12/1"), numbersOf("Move in December 1st"));
  assert.equal(numbersOf("Move in 2026-12-01"), numbersOf("Move in December 1, 2026"));
  assert.equal(numbersOf("Parking is $1,200 a year"), numbersOf("Parking is $1200 a year"));
  // A real change still shows.
  assert.notEqual(numbersOf("Open 9am to 6pm"), numbersOf("Open 9am to 5pm"));
  assert.notEqual(numbersOf("Move in December 1"), numbersOf("Move in January 1"));
});

test("a rewording of the office hours is not a change", () => {
  const current = fact("The leasing office is open 9am to 6pm, Monday to Friday.");
  const p = prop("Leasing office hours are 9:00 AM to 6:00 PM, Monday through Friday.");
  assert.equal(carriesChange(current, p), false);
  assert.deepEqual(decideGroup({ current, props: [p], confirmed: true }), { keep: true });
});

test("a brief mention that only drops numbers never replaces the fuller fact", () => {
  const current = fact("Cats and dogs up to 50 lbs are welcome with a $300 pet deposit and $35 monthly pet rent.", { field_key: "policy.pets", source_id: "pets", value: { deposit: 300, pet_rent: 35, weight_limit_lbs: 50 } });
  const full = prop("Cats and dogs under 50 lbs are welcome; there is a $300 pet deposit and $35 a month in pet rent.", { sourceId: "pets", value: { deposit: 300, monthly_rent: 35, max_lbs: 50 } });
  const brief = prop("Pets are welcome with a $300 deposit.", { sourceId: "faq", value: { deposit: 300 } });
  assert.equal(carriesChange(current, brief), false);
  // The full restatement from /pets is the one considered, never the brief one.
  const both = decideGroup({ current, props: [full, brief], confirmed: false });
  assert.ok(both.keep || both.best === full);
  assert.equal(decideGroup({ current, props: [full, brief], confirmed: true }).keep, true);
  assert.equal(decideGroup({ current, props: [brief] }).keep, true);
  // The same structured value is no change either.
  const valued = { ...current, value: { deposit: 300 } };
  assert.equal(carriesChange(valued, prop("Pets are welcome, $300 deposit, 2 pets max.", { value: { deposit: 300 } })), false);
});

test("a new or different number is still written", () => {
  const current = fact("Parking is $50 a month.", { field_key: "fee.parking" });
  const d = decideGroup({ current, props: [prop("Parking is $75 a month.")] });
  assert.equal(d.keep, false);
  assert.equal(d.best.summary, "Parking is $75 a month.");
  assert.equal(numbersWithin("$50 deposit", "Parking $50, deposit $50"), true);
  assert.equal(numbersWithin("$75", "$50"), false);
});

test("a fact its own page confirmed is not flipped by another page", () => {
  // misc.office-hours from /contact says 9 to 6; the floor plan footers say
  // 9 to 5. A forced read twice changes nothing.
  const current = fact("The office is open 9am to 6pm.", { source_id: "contact" });
  const footer = prop("The office is open 9am to 5pm.", { sourceId: "footer" });
  const kept = new Set(["contact"]);
  assert.deepEqual(decideGroup({ current, props: [footer], confirmed: true, keptFrom: kept }), { keep: true });
  // A change on the fact's own page still goes through, whatever a footer
  // keeps saying (PR 475 review).
  const own = prop("The office is open 10am to 6pm.", { sourceId: "contact" });
  const d = decideGroup({ current, props: [own], confirmed: true, keptFrom: new Set(["footer"]) });
  assert.equal(d.keep, false);
  assert.equal(d.best.sourceId, "contact");
  // Not confirmed by anyone: the change is written.
  assert.equal(decideGroup({ current, props: [footer], confirmed: false }).keep, false);
});

test("a change that only puts back the previous value is held when another page confirms the fact", () => {
  // Read 1 wrote 9 to 5 from the footers (now its own page); /contact
  // proposes 9 to 6 again.
  const current = fact("The office is open 9am to 5pm.", { source_id: "footer" });
  const previous = { summary: "The office is open 9am to 6pm.", value: {}, valid_until: null };
  const back = prop("The office is open 9:00 AM to 6:00 PM.", { sourceId: "contact" });
  assert.deepEqual(decideGroup({ current, props: [back], confirmed: true, keptFrom: new Set(["other"]), previous }), { keep: true });
  // A real new value is not a flip back.
  const fresh = prop("The office is open 8am to 4pm.", { sourceId: "contact" });
  assert.equal(decideGroup({ current, props: [fresh], confirmed: true, keptFrom: new Set(["other"]), previous }).keep, false);
});

const group = (key, summary, current = null) => ({ section: "fees", key, scopeLevel: "property", scopeId: null, current, props: [{ section: "fees", key, summary }] });
const idOf = (f) => `${f.section}|${f.field_key}`;

test("a duplicate or update verdict that loses a number is ignored", () => {
  const surface = { id: "p1", section: "fees", field_key: "fee.parking", scope_level: "property", scope_id: null, summary: "Surface lot parking is $50 a month." };
  for (const verdict of ["duplicate", "update"]) {
    const garage = group("fee.parking-garage", "Garage parking is $100 a month.");
    const groups = new Map([["fees|fee.parking-garage", garage]]);
    const r = mergeDuplicateGroups({ groups, fresh: [["fees|fee.parking-garage", garage]], verdicts: [{ verdict, target: { kind: "fact", fact: surface } }], factIdOf: idOf });
    assert.equal(r.merged, 0, verdict);
    assert.ok(groups.has("fees|fee.parking-garage"), verdict);
    assert.ok(!groups.has("fees|fee.parking"), verdict);
  }
  // New to new: the same guard.
  const a = group("fee.surface", "Surface parking is $50 a month.");
  const b = group("fee.garage", "Garage parking is $100 a month.");
  const groups = new Map([["fees|fee.surface", a], ["fees|fee.garage", b]]);
  const r = mergeDuplicateGroups({ groups, fresh: [...groups.entries()], verdicts: [null, { verdict: "duplicate", target: { kind: "new", index: 0 } }], factIdOf: idOf });
  assert.equal(r.merged, 0);
  assert.equal(groups.size, 2);
});

test("a duplicate that keeps every number is still folded in", () => {
  const surface = { id: "p1", section: "fees", field_key: "fee.parking", scope_level: "property", scope_id: null, summary: "Surface lot parking is $50 a month." };
  const again = group("fee.lot", "Lot parking costs $50 monthly.");
  const groups = new Map([["fees|fee.lot", again]]);
  const r = mergeDuplicateGroups({ groups, fresh: [["fees|fee.lot", again]], verdicts: [{ verdict: "duplicate", target: { kind: "fact", fact: surface } }], factIdOf: idOf });
  assert.equal(r.merged, 1);
  assert.deepEqual(r.touched, ["p1"]);
  assert.equal(groups.size, 0);
});

test("a new fact matched to one already folded into an existing fact follows it there", () => {
  const hours = { id: "h1", section: "misc", field_key: "misc.office-hours", scope_level: "property", scope_id: null, summary: "The office is open 9am to 6pm." };
  const g = (key, summary) => ({ section: "misc", key, scopeLevel: "property", scopeId: null, current: null, props: [{ section: "misc", key, summary }] });
  const n1 = g("misc.leasing-hours", "The leasing office is open 9am to 6pm, Monday to Friday.");
  const n2 = g("misc.hours", "Leasing hours: 9am to 6pm on weekdays.");
  const groups = new Map([["misc|misc.leasing-hours", n1], ["misc|misc.hours", n2]]);
  const r = mergeDuplicateGroups({
    groups, fresh: [...groups.entries()], factIdOf: idOf,
    verdicts: [{ verdict: "update", target: { kind: "fact", fact: hours } }, { verdict: "duplicate", target: { kind: "new", index: 0 } }],
  });
  assert.equal(r.merged, 2);
  assert.deepEqual([...groups.keys()], ["misc|misc.office-hours"]);
  assert.equal(groups.get("misc|misc.office-hours").props.length, 2);

  // N1 dropped as a duplicate of the existing fact: N2 is dropped with it.
  const m1 = g("misc.leasing-hours", "Leasing office: 9am to 6pm.");
  const m2 = g("misc.hours", "Open 9am to 6pm.");
  const groups2 = new Map([["misc|misc.leasing-hours", m1], ["misc|misc.hours", m2]]);
  const r2 = mergeDuplicateGroups({
    groups: groups2, fresh: [...groups2.entries()], factIdOf: idOf,
    verdicts: [{ verdict: "duplicate", target: { kind: "fact", fact: hours } }, { verdict: "duplicate", target: { kind: "new", index: 0 } }],
  });
  assert.equal(r2.merged, 2);
  assert.equal(groups2.size, 0);
  assert.deepEqual(r2.touched, ["h1", "h1"]);
});
