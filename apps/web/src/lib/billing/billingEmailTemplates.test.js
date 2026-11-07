/*
 * Run with: npm test (from apps/web).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as t from "./billingEmailTemplates.js";

const charge = {
  amountCents: 125000,
  triggerType: "finalize_deal",
  listingLabel: "123 Main St",
  leaseLabel: "Unit 2, 12-month",
  studentName: "Sam Lee",
};
const EM_DASH = String.fromCharCode(0x2014);
const URL = "https://useproximity.org/dashboard/landlord/payments";

const ALL = [
  t.contestSubmittedTeamEmail({ landlordName: "Pat", landlordEmail: "pat@x.com", charge, reason: "wrong", adminUrl: URL }),
  t.contestOutcomeEmail({ name: "Pat", outcome: "approved", charge, paymentsUrl: URL }),
  t.contestOutcomeEmail({ name: "Pat", outcome: "voided", charge, paymentsUrl: URL }),
  t.paymentFailedEmail({ name: "Pat", totalCents: 5000, retryUrl: URL, reason: "insufficient funds" }),
  t.paymentFailedTeamEmail({ landlordName: "Pat", landlordEmail: "pat@x.com", totalCents: 5000, reason: "x" }),
  t.paymentMethodAttentionEmail({ name: "Pat", state: "expired", description: "Visa ending 4242", paymentsUrl: URL }),
  t.overdueEmail({ name: "Pat", totalCents: 5000, invoiceDate: "2026-11-02T00:00:00Z", paymentsUrl: URL }),
  t.overdueTeamEmail({ landlordName: "Pat", landlordEmail: "pat@x.com", totalCents: 5000, invoiceDate: "2026-11-02T00:00:00Z", withdrawnCount: 3 }),
  t.chargebackTeamEmail({ landlordName: "Pat", landlordEmail: "pat@x.com", amountCents: 5000, reason: "fraudulent", invoiceId: "in_1" }),
  t.methodRemovedTeamEmail({ landlordName: "Pat", landlordEmail: "pat@x.com", outstandingCents: 7500 }),
  t.enrollmentEmail({ name: "Pat", deadline: "December 15", paymentsUrl: URL }),
];

describe("billing email templates", () => {
  it("every email has a subject and a body", () => {
    for (const m of ALL) {
      assert.ok(m.subject.length > 0);
      assert.ok(m.html.length > 0);
    }
  });

  it("never contains an em dash (repo rule)", () => {
    for (const m of ALL) {
      assert.ok(!m.subject.includes(EM_DASH) && !m.html.includes(EM_DASH), m.subject);
    }
  });

  it("shows the amount, listing, lease and student for a charge", () => {
    const { html } = t.contestSubmittedTeamEmail({ landlordName: "Pat", landlordEmail: "pat@x.com", charge, reason: "wrong", adminUrl: URL });
    for (const s of ["$1,250.00", "Finalize deal", "123 Main St", "Unit 2, 12-month", "Sam Lee", "wrong"]) {
      assert.ok(html.includes(s), s);
    }
  });

  it("escapes anything a person typed", () => {
    const { html } = t.contestSubmittedTeamEmail({
      landlordName: "<b>Pat</b>",
      landlordEmail: "pat@x.com",
      charge: { ...charge, studentName: "<script>alert(1)</script>" },
      reason: '"><img src=x onerror=alert(1)>',
      adminUrl: URL,
    });
    assert.ok(!html.includes("<script>"));
    assert.ok(!html.includes("<img"));
    assert.ok(!html.includes("<b>Pat</b>"));
    assert.ok(html.includes("&lt;script&gt;"));
  });

  it("tells the landlord a lost contest removed the charge and a won one keeps it", () => {
    assert.match(t.contestOutcomeEmail({ name: "P", outcome: "voided", charge, paymentsUrl: URL }).html, /will not be charged/);
    assert.match(t.contestOutcomeEmail({ name: "P", outcome: "approved", charge, paymentsUrl: URL }).html, /next monthly invoice/);
  });

  it("the outcome email has no field for the internal admin note", () => {
    const { html } = t.contestOutcomeEmail({ name: "P", outcome: "voided", charge, paymentsUrl: URL, adminNote: "SECRET INTERNAL NOTE" });
    assert.ok(!html.includes("SECRET INTERNAL NOTE"));
  });

  it("the failed-payment email links to pay and says it will not retry", () => {
    const { html } = t.paymentFailedEmail({ name: "Pat", totalCents: 5000, retryUrl: URL, reason: null });
    assert.ok(html.includes(URL));
    assert.match(html, /not retry/);
  });

  it("the overdue emails give the invoice date and lease count", () => {
    const team = t.overdueTeamEmail({ landlordName: "Pat", landlordEmail: "p@x.com", totalCents: 5000, invoiceDate: "2026-11-02T00:00:00Z", withdrawnCount: 3 });
    assert.ok(team.html.includes("2026-11-02"));
    assert.ok(team.html.includes("3"));
  });
});

describe("receipt and correction emails (Simão's notes, 2026-11-07)", () => {
  it("the receipt says what was paid, with what, and links the PDF", () => {
    const m = t.invoicePaidEmail({
      name: "Lee",
      periodLabel: "November 2026",
      totalCents: 41200,
      methodDescription: "Visa ending 4242",
      paidAt: "2026-11-07T18:00:00Z",
      pdfUrl: "https://pdf.example/x",
      paymentsUrl: "https://app/billing",
    });
    assert.match(m.subject, /Payment received: \$412\.00 for November 2026/);
    assert.match(m.html, /Visa ending 4242/);
    assert.match(m.html, /https:\/\/pdf\.example\/x/);
  });

  it("a refund and a credit say where the money goes, and escape the reason", () => {
    const refund = t.chargeAdjustedEmail({ name: "Lee", kind: "refund", amountCents: 2500, charge, reason: "<b>dup</b>", paymentsUrl: "u" });
    assert.match(refund.subject, /Refund of \$25\.00/);
    assert.match(refund.html, /goes back to the card or bank account/);
    assert.match(refund.html, /&lt;b&gt;dup&lt;\/b&gt;/);
    const credit = t.chargeAdjustedEmail({ name: "Lee", kind: "credit", amountCents: 2500, charge, paymentsUrl: "u" });
    assert.match(credit.subject, /Credit of \$25\.00/);
    assert.match(credit.html, /next monthly invoice/);
  });
});
