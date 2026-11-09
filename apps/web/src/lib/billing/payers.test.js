/*
 * Run with: npm test (from apps/web).
 *
 * A payer who signs and pays for another landlord account (Project B, Wyatt
 * 2026-11-09), against the in-memory database and Documenso. The payer holds ONE
 * master agreement; each account they pay for adds its properties by addendum;
 * coverage stays on the account; the account itself never signs.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fakeDb, fakeDocumenso } from "./billingFakes.testutil.js";
import { agreementState, applyEnvelope, coverageFor, coveringAgreement, documentParts, listAgreementDocuments, startSigning } from "./agreements.js";
import { cleanPayerInput, endPayerFor, landlordPayerView, namePayer, payerAccounts, releaseWaiting, requestPayerCoverage } from "./payers.js";
import { coverageOnly, gateResponseBody, payerCanFix } from "./listingGate.js";
import { payeeChargeView, statusMessage } from "./chargeDisplay.js";
import { lineDescription, planInvoices } from "./invoicePlan.js";

const MASTER = {
  id: "vm",
  label: "Agreement 2027",
  kind: "master",
  landlord_id: null,
  status: "live",
  requires_resign: false,
  published_at: "2026-12-01T00:00:00Z",
  commission_rate_percent: 25,
  provider_template_id: "envelope_master",
  provider_recipient_id: 11,
};
const AMENDMENT = { ...MASTER, id: "va", label: "Amendment 2027", kind: "amendment", provider_template_id: "envelope_amend" };

const pm = { id: "pm1", name: "Pat Manager", email: "pat@pm.example.com" };
const pm2 = { id: "pm2", name: "Quinn Manager", email: "quinn@pm.example.com" };
const owner = { id: "own", name: "Jane Owner", email: "jane@owner.example.com" };

const listing = (id, address, published = true) => ({ id, address, published_at: published ? "2026-10-01T00:00:00Z" : null });
const unit = (id, listingId, name, published = true) => ({ id, listing_id: listingId, name, published_at: published ? "2026-10-01T00:00:00Z" : null });

// Two property manager accounts, both paid for by the owner: pm1 has 100 Live St
// and a draft 200 Draft Ave; pm2 has 300 Other Rd.
function world(extra = {}) {
  return fakeDb({
    agreement_versions: [{ ...MASTER }, { ...AMENDMENT }],
    roles: [{ id: "r-landlord", name: "landlord" }],
    users: [
      { ...pm, roles: { name: "landlord" } },
      { ...pm2, roles: { name: "landlord" } },
      { ...owner, billing_only: true, roles: { name: "landlord" } },
      { id: "stu", name: "Sam Student", email: "sam@wustl.edu", roles: { name: "student" } },
    ],
    listing_landlords: [
      { user_id: "pm1", listing_id: "L1" },
      { user_id: "pm1", listing_id: "L2" },
      { user_id: "pm2", listing_id: "L3" },
    ],
    listings: [listing("L1", "100 Live St"), listing("L2", "200 Draft Ave", false), listing("L3", "300 Other Rd")],
    listing_units: [unit("U1", "L1", "Apt 1"), unit("U2", "L2", "Studio", false), unit("U3", "L3", "Loft")],
    unit_leases: [],
    billing_payers: [
      { id: "link1", landlord_id: "pm1", payer_id: "own", listing_id: null, signer_name: "Jane Owner", signer_email: owner.email, status: "active", invited_at: "2026-11-09T00:00:00Z", declined_at: null, created_at: "2026-11-09T00:00:00Z" },
    ],
    payer_publish_requests: [],
    ...extra,
  });
}

const storeSigned = async ({ userId }) => `billing/agreements/${userId}/signed.pdf`;
const signFor = (db, documenso, accountId, over = {}) =>
  startSigning(db, documenso, { user: owner, signerTitle: "Owner", signerName: "Jane Owner", authorized: true, accountId, ...over });

async function ownerSignedFor(accountId = "pm1", listingIds = []) {
  const db = world();
  const documenso = fakeDocumenso();
  await signFor(db, documenso, accountId, { listingIds });
  documenso.complete("envelope_1", "2027-01-05T12:00:00.000Z");
  const signed = [];
  const result = await applyEnvelope(db, documenso, await documenso.getEnvelope("envelope_1"), { storeSigned, onSigned: (x) => signed.push(x) });
  return { db, documenso, result, signed };
}

describe("payer: who may sign", () => {
  it("the landlord account itself can no longer sign once it has a payer", async () => {
    const db = world();
    await assert.rejects(
      () => startSigning(db, fakeDocumenso(), { user: pm, signerTitle: "Manager", signerName: "Pat Manager", authorized: true }),
      (e) => e.code === "payer_signs" && /Jane Owner/.test(e.message)
    );
  });

  it("nobody else can sign for an account they don't pay for", async () => {
    const db = world();
    await assert.rejects(() => startSigning(db, fakeDocumenso(), { user: pm2, signerTitle: "Manager", signerName: "Quinn Manager", authorized: true, accountId: "pm1" }), (e) => e.code === "payer_signs");
  });
});

describe("payer: the master agreement covers the account's properties", () => {
  it("is the payer's document, while the coverage stays on the account", async () => {
    const { db, result, signed } = await ownerSignedFor("pm1");
    assert.equal(result, "signed");
    const master = db.tables.landlord_agreements[0];
    assert.equal(master.user_id, "own", "the master belongs to the payer");
    assert.ok(db.tables.agreement_coverage.every((c) => c.user_id === "pm1" && c.agreement_id === master.id));
    // The webhook is told which account it covered, so its listings can go live.
    assert.deepEqual(Object.keys(signed[0].accounts), ["pm1"]);
    assert.equal(signed[0].signerId, "own");
  });

  it("the account's state and coverage read the payer's master", async () => {
    const { db } = await ownerSignedFor("pm1");
    const state = await agreementState(db, "pm1", new Date("2027-02-01"));
    assert.equal(state.holderId, "own");
    assert.equal(state.valid, true);
    const { covered } = await coverageFor(db, "pm1", new Date("2027-02-01"));
    assert.deepEqual([...covered.keys()], ["L1"], "the live property, not the draft nobody asked to publish");
  });

  it("a charge on the account records the payer as who is invoiced", async () => {
    const { db } = await ownerSignedFor("pm1");
    const c = await coveringAgreement(db, "pm1", "L1", new Date("2027-02-01"));
    assert.equal(c.holderId, "own");
    assert.equal(c.commissionRatePercent, 25);
  });

  it("only the payer can open the signed agreement", async () => {
    const { db } = await ownerSignedFor("pm1");
    assert.ok((await documentParts(db, { userId: "own", kind: "master" })).length > 0);
    assert.equal((await documentParts(db, { userId: "pm1", kind: "master" })).length, 0);
  });
});

describe("payer: one agreement for several accounts (admin assigns, Wyatt 2026-11-09)", () => {
  it("one signature covers every account's properties, each row on its own account", async () => {
    const db = world();
    db.tables.billing_payers.push({ id: "link2", landlord_id: "pm2", payer_id: "own", listing_id: null, signer_name: "Jane Owner", signer_email: owner.email, status: "active", invited_at: "2026-11-09T00:00:00Z", created_at: "2026-11-09T00:01:00Z" });
    const documenso = fakeDocumenso();
    await signFor(db, documenso, "pm1", { accountIds: ["pm1", "pm2"] });
    assert.equal(db.tables.landlord_agreements.length, 1, "one master");
    documenso.complete("envelope_1", "2027-01-05T12:00:00.000Z");
    const signed = [];
    await applyEnvelope(db, documenso, await documenso.getEnvelope("envelope_1"), { storeSigned, onSigned: (x) => signed.push(x) });
    assert.deepEqual(Object.keys(signed[0].accounts).sort(), ["pm1", "pm2"]);
    assert.deepEqual([...(await coverageFor(db, "pm1", new Date("2027-02-01"))).covered.keys()], ["L1"]);
    assert.deepEqual([...(await coverageFor(db, "pm2", new Date("2027-02-01"))).covered.keys()], ["L3"]);
  });

  it("refuses an account the signer doesn't pay for", async () => {
    const db = world();
    await assert.rejects(() => signFor(db, fakeDocumenso(), "pm1", { accountIds: ["pm1", "pm2"] }), (e) => e.code === "payer_signs");
  });
});

describe("payer: addenda for what the landlord publishes", () => {
  it("a second account is added to the same master by an addendum it owns and the payer signed", async () => {
    const { db, documenso } = await ownerSignedFor("pm1");
    db.tables.billing_payers.push({ id: "link2", landlord_id: "pm2", payer_id: "own", listing_id: null, signer_name: "Jane Owner", signer_email: owner.email, status: "active", invited_at: "2027-01-06T00:00:00Z", created_at: "2027-01-06T00:00:00Z" });
    await signFor(db, documenso, "pm2", { now: new Date("2027-01-07") });
    const addendum = db.tables.agreement_amendments[0];
    assert.equal(addendum.user_id, "pm2", "an addendum belongs to the account whose properties it adds");
    assert.equal(addendum.signer_id, "own");
    assert.equal(addendum.agreement_id, db.tables.landlord_agreements[0].id, "one master for the payer");
    documenso.complete("envelope_2", "2027-01-07T12:00:00.000Z");
    const signed = [];
    await applyEnvelope(db, documenso, await documenso.getEnvelope("envelope_2"), { storeSigned, onSigned: (x) => signed.push(x) });
    assert.deepEqual(Object.keys(signed[0].accounts), ["pm2"]);
    const { covered } = await coverageFor(db, "pm2", new Date("2027-02-01"));
    assert.deepEqual([...covered.keys()], ["L3"]);
    // The payer sees the addendum they signed; the landlord account does not.
    const ownerDocs = await listAgreementDocuments(db, "own");
    assert.ok(ownerDocs.some((d) => d.kind === "amendment"));
    const pmDocs = await listAgreementDocuments(db, "pm2");
    assert.ok(!pmDocs.some((d) => d.kind === "amendment"));
  });

  it("a landlord's listings wait, join one pending request, and only the first emails the payer", async () => {
    const { db } = await ownerSignedFor("pm1");
    const first = await requestPayerCoverage(db, fakeDocumenso(), { landlordId: "pm1", listingIds: ["L2"] });
    assert.equal(first.firstRequest, true);
    db.tables.listings.push(listing("L9", "900 Later Ln", false));
    db.tables.listing_landlords.push({ user_id: "pm1", listing_id: "L9" });
    const second = await requestPayerCoverage(db, fakeDocumenso(), { landlordId: "pm1", listingIds: ["L9", "L2"] });
    assert.equal(second.firstRequest, false, "added to the addendum already waiting: no second email");
    assert.equal(second.added, 1);
    assert.deepEqual(db.tables.payer_publish_requests.map((r) => r.listing_id).sort(), ["L2", "L9"]);
  });

  it("the payer's addendum covers what was asked, and releaseWaiting publishes it and emails the landlord", async () => {
    const { db, documenso } = await ownerSignedFor("pm1");
    await requestPayerCoverage(db, documenso, { landlordId: "pm1", listingIds: ["L2"] });
    await signFor(db, documenso, "pm1", { listingIds: ["L2"], now: new Date("2027-01-07") });
    documenso.complete("envelope_2", "2027-01-07T12:00:00.000Z");
    await applyEnvelope(db, documenso, await documenso.getEnvelope("envelope_2"), { storeSigned });
    const published = [];
    const emails = [];
    const r = await releaseWaiting(db, {
      landlordId: "pm1",
      deps: {
        checkGate: async () => ({ allowed: true, missing: [], uncovered: [] }),
        publish: async (landlordId, listingId) => published.push([landlordId, listingId]),
        notifyLive: async (x) => emails.push(x),
      },
    });
    assert.deepEqual(published, [["pm1", "L2"]]);
    assert.deepEqual(r.published, ["200 Draft Ave"]);
    assert.equal(emails[0].payerName, "Jane Owner");
    assert.equal(db.tables.payer_publish_requests[0].status, "published");
  });

  it("nothing is published while the gate still refuses for something other than coverage", async () => {
    const db = world();
    await requestPayerCoverage(db, fakeDocumenso(), { landlordId: "pm1", listingIds: ["L2"] });
    const r = await releaseWaiting(db, {
      landlordId: "pm1",
      deps: { checkGate: async () => ({ allowed: false, missing: ["overdue_invoice"], uncovered: [] }), publish: async () => assert.fail("must not publish") },
    });
    assert.deepEqual(r.published, []);
    assert.equal(db.tables.payer_publish_requests[0].status, "waiting");
  });
});

describe("payer: what each side sees", () => {
  it("the landlord sees status only: Pending until signed, then Signed", async () => {
    const db = world();
    const pending = await landlordPayerView(db, "pm1");
    assert.equal(pending.status, "pending");
    assert.equal(pending.payer.name, "Jane Owner");
    assert.equal(pending.canChange, true);
    assert.equal("agreement" in pending, false, "never the agreement");
    const { db: signedDb } = await ownerSignedFor("pm1");
    const signed = await landlordPayerView(signedDb, "pm1", new Date("2027-02-01"));
    assert.equal(signed.status, "signed");
    assert.equal(signed.canChange, false, "only the payer can end it once signed");
  });

  it("a decline shows the landlord Declined, and the change request is the payer's", async () => {
    const db = world();
    const documenso = fakeDocumenso();
    await signFor(db, documenso, "pm1");
    documenso.reject("envelope_1", "Rate too high");
    const declined = [];
    await applyEnvelope(db, documenso, await documenso.getEnvelope("envelope_1"), { onDeclined: async (x) => declined.push(x) });
    assert.equal(declined[0].userId, "own", "the payer discusses it with the team");
    assert.equal((await landlordPayerView(db, "pm1")).status, "declined");
    // Asking again clears it.
    await requestPayerCoverage(db, documenso, { landlordId: "pm1", listingIds: ["L2"] });
    assert.equal((await landlordPayerView(db, "pm1")).status, "pending");
  });

  it("the payer sees each account they pay for, and what needs their signature", async () => {
    const db = world();
    const [a] = await payerAccounts(db, "own");
    assert.equal(a.landlordId, "pm1");
    assert.equal(a.needs, "agreement");
    assert.deepEqual(a.waiting.map((w) => w.address), ["100 Live St"]);
  });

  it("a landlord's charges read Billed to the payer once approved: never paid, refunded or credited", () => {
    const paid = payeeChargeView({ id: "c1", status: "paid", createdAt: "2027-02-01", settledAt: "2027-03-01", adjustments: [{ kind: "credit", amountCents: 100 }] }, "Jane Owner");
    assert.equal(paid.status, "billed");
    assert.deepEqual(paid.adjustments, []);
    assert.match(statusMessage(paid), /Billed to Jane Owner/);
    const pending = payeeChargeView({ id: "c2", status: "pending", createdAt: "2027-02-01", adjustments: [] }, "Jane Owner");
    assert.equal(pending.status, "pending", "still theirs to approve or contest");
  });
});

describe("payer: voiding and changing", () => {
  it("the payer voids for one account: its properties come off, the link ends, the master stands", async () => {
    const { db, documenso } = await ownerSignedFor("pm1");
    const r = await endPayerFor(db, documenso, { payerId: "own", landlordId: "pm1" });
    assert.equal(r.released, 1);
    assert.equal(db.tables.billing_payers[0].status, "ended");
    assert.equal(db.tables.landlord_agreements[0].status, "signed");
    await assert.rejects(() => endPayerFor(db, documenso, { payerId: "pm2", landlordId: "pm1" }), (e) => e.code === "not_payer");
  });

  it("naming a payer refuses the landlord's own email and a student", async () => {
    const db = world({ billing_payers: [] });
    await assert.rejects(() => namePayer(db, { landlord: pm, name: "Pat", email: pm.email }), (e) => e.code === "payer_is_you");
    await assert.rejects(() => namePayer(db, { landlord: pm, name: "Sam Student", email: "sam@wustl.edu" }), (e) => e.code === "payer_not_landlord");
  });

  it("cleans the payer's name and email", () => {
    assert.deepEqual(cleanPayerInput({ name: "  Jane   Owner ", email: " Jane@Owner.Example.com " }), { name: "Jane Owner", email: "jane@owner.example.com" });
    assert.throws(() => cleanPayerInput({ name: "Jane", email: "not an email" }), (e) => e.code === "bad_email");
  });
});

describe("payer: the publish check and invoices", () => {
  it("with a payer, a missing agreement or payment method waits for them; an overdue invoice still blocks", () => {
    assert.equal(payerCanFix(["agreement", "payment_method"]), true);
    assert.equal(payerCanFix(["overdue_invoice"]), false);
    assert.equal(coverageOnly({ payer: { name: "Jane" }, missing: ["payment_method"] }), true);
    assert.equal(coverageOnly({ missing: ["payment_method"] }), false);
    const body = gateResponseBody({ missing: ["payment_method"], uncovered: [], targets: ["L1"], payer: { name: "Jane Owner" } });
    assert.equal(body.payer.name, "Jane Owner");
    assert.deepEqual(body.uncovered.map((u) => u.listingId), ["L1"], "the listing itself waits when only the payment method is missing");
    assert.match(body.drafted, /goes live once Jane Owner signs/);
  });

  it("one invoice per payer, lines grouped and labelled by account", () => {
    const charge = (id, landlord, account, cents, at) => ({ id, landlord_id: landlord, account_label: account, amount_cents: cents, status: "approved", invoice_id: null, created_at: at, trigger_type: "lease_signed" });
    const plan = planInvoices(
      [charge("c1", "own", "West LLC", 500, "2027-02-03"), charge("c2", "own", "East LLC", 700, "2027-02-01"), charge("c3", "own", null, 600, "2027-02-02")],
      { billingPeriod: "2027-02-01" }
    );
    assert.equal(plan.invoices.length, 1);
    assert.equal(plan.invoices[0].totalCents, 1800);
    assert.match(lineDescription({ trigger_type: "lease_signed", account_label: "West LLC" }), /^Account: West LLC/);
  });
});
