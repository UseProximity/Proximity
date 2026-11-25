import { test } from "node:test";
import assert from "node:assert/strict";
import { importHints } from "./hints.js";

test("hints name the units and the field, calmly", () => {
  const hints = importHints({ units: [
    { name: "Cole", bedrooms: 2, bathrooms: 2, area: 1136, offers: [{ rent: 1250, rentExact: false, leaseTermMonths: [], availableNow: true }] },
    { name: "Papin", bedrooms: 0, bathrooms: 1, area: 543, offers: [{ rent: 965, rentExact: true, rentIsPerPerson: false, leaseTermMonths: [12], availableNow: true }] },
    { name: "Lucas", bedrooms: 2, bathrooms: 2, area: 1020, offers: [] },
  ] });
  assert.ok(hints[0].startsWith("Cole: your site shows a starting-at price ($1,250"));
  assert.ok(hints.some((h) => h.startsWith("Lucas: no price found")));
  assert.ok(hints.every((h) => !/error|fail|could not|couldn't/i.test(h)));
});

test("a read with no units says what to do next", () => {
  assert.equal(importHints({ units: [] }).length, 1);
});
