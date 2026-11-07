/*
 * Run with: npm test (from apps/web).
 *
 * The enrollment rules that need no database. Who is in the audience is checked
 * against the dev database separately.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatDeadline, sendEnrollmentEmails, setEnrollmentWindow } from "./enrollment.js";
import { enrollmentEmail } from "./billingEmailTemplates.js";

describe("formatDeadline", () => {
  it("writes a date the way an email would", () => {
    assert.equal(formatDeadline("2026-12-15"), "December 15, 2026");
    assert.equal(formatDeadline("2027-01-02"), "January 2, 2027");
    assert.equal(formatDeadline(null), null);
    assert.equal(formatDeadline(""), null);
  });
});

describe("setEnrollmentWindow validation", () => {
  const db = { from() { throw new Error("should not reach the database"); } };
  const now = new Date("2026-11-10T12:00:00Z");

  it("refuses a malformed or past deadline before saving anything", async () => {
    for (const deadline of ["next friday", "2026-13-40", "12/15/2026", "2026-11-09"]) {
      await assert.rejects(() => setEnrollmentWindow(db, { deadline, includeAgreement: false }, "a", now), /deadline|date/i, deadline);
    }
  });
});

describe("sendEnrollmentEmails", () => {
  const people = Array.from({ length: 5 }, (_, i) => ({ id: `u${i}`, name: `P${i}`, email: `p${i}@x.com` }));

  it("counts sent and failed, and sends to each person once", async () => {
    const seen = [];
    const result = await sendEnrollmentEmails({
      toSend: people,
      send: async (l) => { seen.push(l.id); return l.id !== "u2"; },
    });
    assert.deepEqual(result, { attempted: 5, sent: 4, failed: 1, remaining: 0 });
    assert.deepEqual(seen, ["u0", "u1", "u2", "u3", "u4"]);
  });

  it("stops at the limit and says how many are left, so a click cannot outrun the function", async () => {
    let calls = 0;
    const result = await sendEnrollmentEmails({ toSend: people, limit: 2, send: async () => { calls += 1; return true; } });
    assert.deepEqual(result, { attempted: 2, sent: 2, failed: 0, remaining: 3 });
    assert.equal(calls, 2);
  });

  it("does nothing for an empty audience", async () => {
    assert.deepEqual(await sendEnrollmentEmails({ toSend: [], send: async () => true }), { attempted: 0, sent: 0, failed: 0, remaining: 0 });
  });
});

describe("enrollmentEmail", () => {
  const url = "https://useproximity.org/dashboard/landlord?tab=billing";

  it("asks for a payment method and the agreement when the agreement is ready", () => {
    const { html } = enrollmentEmail({ name: "Pat", deadline: "December 15, 2026", includeAgreement: true, paymentsUrl: url });
    assert.match(html, /add a payment method and sign the marketing agreement by December 15, 2026/);
    assert.ok(html.includes(url));
  });

  it("asks only for a payment method until the agreement is ready", () => {
    const { html } = enrollmentEmail({ name: "Pat", deadline: "December 15, 2026", includeAgreement: false, paymentsUrl: url });
    assert.match(html, /add a payment method by December 15, 2026/);
    assert.ok(!/marketing agreement/.test(html));
  });

  it("works without a deadline and never uses an em dash", () => {
    const { html, subject } = enrollmentEmail({ name: "Pat", paymentsUrl: url });
    assert.match(html, /sign the marketing agreement\. A bank account/);
    assert.ok(!html.includes("undefined"));
    const dash = String.fromCharCode(0x2014);
    assert.ok(!html.includes(dash) && !subject.includes(dash));
  });

  it("escapes the landlord's name", () => {
    const { html } = enrollmentEmail({ name: "<script>x</script>", paymentsUrl: url });
    assert.ok(!html.includes("<script>"));
  });
});
