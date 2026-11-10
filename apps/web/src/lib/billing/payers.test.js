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
import { approveWaiting, cancelPayerDocuments, changePayer, cleanPayerInput, endPayerFor, landlordPayerView, lookupPayer, namePayer, payerAccounts, requestPayerCoverage, settleSignedDocument, settleStaleDocuments } from "./payers.js";
import { checkListingGate, coverageOnly, gateResponseBody, payerCanFix } from "./listingGate.js";
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
    assert.deepEqual([...covered.keys()].sort(), ["L1", "L2"], "the live property, and the draft riding along (the signer can leave drafts off)");
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
    assert.deepEqual([...(await coverageFor(db, "pm1", new Date("2027-02-01"))).covered.keys()].sort(), ["L1", "L2"]);
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

  it("every send asks the payer to sign what isn't covered yet, never only the first", async () => {
    const { db } = await ownerSignedFor("pm1", ["L1"]);
    db.tables.listings.push(listing("L9", "900 Later Ln", false), listing("L10", "1000 New Rd", false));
    db.tables.listing_landlords.push({ user_id: "pm1", listing_id: "L9" }, { user_id: "pm1", listing_id: "L10" });
    const first = await requestPayerCoverage(db, fakeDocumenso(), { landlordId: "pm1", listingIds: ["L9"], now: new Date("2027-02-01") });
    assert.deepEqual(first.toSign, ["L9"]);
    const second = await requestPayerCoverage(db, fakeDocumenso(), { landlordId: "pm1", listingIds: ["L10", "L9"], now: new Date("2027-02-01") });
    assert.deepEqual(second.toSign, ["L10"], "an email for the new one even though L9 is still waiting");
    assert.equal(second.added, 1);
  });

  it("a listing the payer's agreement already covers is approved at once, and nothing is published", async () => {
    const { db } = await ownerSignedFor("pm1");
    const r = await requestPayerCoverage(db, fakeDocumenso(), { landlordId: "pm1", listingIds: ["L2"], now: new Date("2027-02-01") });
    assert.deepEqual(r.toSign, []);
    assert.deepEqual(r.approved, ["200 Draft Ave"]);
    assert.equal(db.tables.payer_publish_requests[0].status, "approved");
    assert.equal(db.tables.listings.find((l) => l.id === "L2").published_at, null, "still a draft: the landlord publishes it");
    const view = await landlordPayerView(db, "pm1", new Date("2027-02-01"));
    assert.deepEqual(view.approved.map((a) => a.address), ["200 Draft Ave"]);
  });
});

describe("payer: what the signer opened is locked in (Wyatt, 2026-11-09)", () => {
  async function openAddendum() {
    const { db, documenso } = await ownerSignedFor("pm1", ["L1"]);
    db.tables.listings.push(listing("L9", "900 Later Ln", false));
    db.tables.listing_landlords.push({ user_id: "pm1", listing_id: "L9" });
    await requestPayerCoverage(db, documenso, { landlordId: "pm1", listingIds: ["L9"] });
    await signFor(db, documenso, "pm1", { listingIds: ["L9"], now: new Date("2027-01-07") });
    return { db, documenso };
  }

  it("a listing sent while the payer is signing never cancels their document, and waits for the next one", async () => {
    const { db, documenso } = await openAddendum();
    const addendum = db.tables.agreement_amendments.at(-1);
    assert.equal(addendum.status, "sent");
    // A listing made after the payer opened the document, sent while they sign.
    db.tables.listings.push(listing("L10", "1000 New Rd", false));
    db.tables.listing_landlords.push({ user_id: "pm1", listing_id: "L10" });
    await requestPayerCoverage(db, documenso, { landlordId: "pm1", listingIds: ["L10"] });
    assert.equal(addendum.status, "sent", "the open document stays");
    assert.equal(documenso.calls.cancelled.length, 0);
    const req = (id) => db.tables.payer_publish_requests.find((r) => r.listing_id === id);
    assert.equal(req("L9").document_id, addendum.id, "L9 is on the document");
    assert.equal(req("L10").document_id ?? null, null, "L10 waits for the next one");
    documenso.complete("envelope_2", "2027-01-07T12:00:00.000Z");
    const signed = [];
    await applyEnvelope(db, documenso, await documenso.getEnvelope("envelope_2"), { storeSigned, onSigned: (x) => signed.push(x) });
    const result = await settleSignedDocument(db, { kind: signed[0].kind, id: signed[0].documentId, now: new Date("2027-02-01") });
    assert.deepEqual(result.pm1.approved, ["900 Later Ln"]);
    assert.equal(req("L9").status, "approved");
    assert.equal(req("L10").status, "waiting", "still pending, not declined");
    assert.equal(db.tables.listings.find((l) => l.id === "L9").published_at, null, "approving never publishes");
  });

  it("a listing on the document that the signer left off reads Declined, and can be sent again", async () => {
    const { db, documenso } = await ownerSignedFor("pm1", ["L1"]);
    db.tables.listings.push(listing("L9", "900 Later Ln", false), listing("L12", "1200 Kept Ct", false));
    db.tables.listing_landlords.push({ user_id: "pm1", listing_id: "L9" }, { user_id: "pm1", listing_id: "L12" });
    await requestPayerCoverage(db, documenso, { landlordId: "pm1", listingIds: ["L9", "L12"] });
    await signFor(db, documenso, "pm1", { listingIds: ["L9", "L12"], exhibit: [{ listingId: "L9", include: false, excluded: true }], now: new Date("2027-01-07") });
    documenso.complete("envelope_2", "2027-01-07T12:00:00.000Z");
    const signed = [];
    await applyEnvelope(db, documenso, await documenso.getEnvelope("envelope_2"), { storeSigned, onSigned: (x) => signed.push(x) });
    const result = await settleSignedDocument(db, { kind: signed[0].kind, id: signed[0].documentId, now: new Date("2027-02-01") });
    assert.deepEqual(result.pm1.declined, ["900 Later Ln"]);
    assert.deepEqual(result.pm1.approved, ["1200 Kept Ct"]);
    const view = await landlordPayerView(db, "pm1", new Date("2027-02-01"));
    assert.deepEqual(view.declined.map((d) => d.address), ["900 Later Ln"]);
    // Send again: back to waiting, no longer shown as declined.
    const again = await requestPayerCoverage(db, documenso, { landlordId: "pm1", listingIds: ["L9"], now: new Date("2027-02-01") });
    assert.deepEqual(again.toSign, ["L9"]);
    assert.deepEqual((await landlordPayerView(db, "pm1", new Date("2027-02-01"))).declined, []);
  });

  it("a rejected document marks its listings Declined; one cancelled unsigned puts them back to waiting", async () => {
    const { db, documenso } = await openAddendum();
    documenso.reject("envelope_2", "Not this one");
    await applyEnvelope(db, documenso, await documenso.getEnvelope("envelope_2"), {});
    assert.equal(db.tables.payer_publish_requests.find((r) => r.listing_id === "L9").status, "declined");

    const second = await openAddendum();
    const addendum = second.db.tables.agreement_amendments.at(-1);
    await cancelPayerDocuments(second.db, second.documenso, "pm1");
    assert.equal(addendum.status, "voided");
    const row = second.db.tables.payer_publish_requests.find((r) => r.listing_id === "L9");
    assert.equal(row.status, "waiting");
    assert.equal(row.document_id, null, "goes on the next document");
  });

  it("signing one account's addendum never touches another account the payer signs for", async () => {
    const { db, documenso } = await openAddendum();
    db.tables.billing_payers.push({ id: "link2", landlord_id: "pm2", payer_id: "own", listing_id: null, signer_name: "Jane Owner", signer_email: owner.email, status: "active", invited_at: "2027-01-06T00:00:00Z", created_at: "2027-01-06T00:00:00Z" });
    db.tables.listings.push(listing("L11", "1100 Side St", false));
    db.tables.listing_landlords.push({ user_id: "pm2", listing_id: "L11" });
    await requestPayerCoverage(db, documenso, { landlordId: "pm2", listingIds: ["L11"] });
    documenso.complete("envelope_2", "2027-01-07T12:00:00.000Z");
    const signed = [];
    await applyEnvelope(db, documenso, await documenso.getEnvelope("envelope_2"), { storeSigned, onSigned: (x) => signed.push(x) });
    const result = await settleSignedDocument(db, { kind: signed[0].kind, id: signed[0].documentId, accounts: Object.keys(signed[0].accounts), now: new Date("2027-02-01") });
    assert.deepEqual(Object.keys(result), ["pm1"], "pm2 was not on the document");
    assert.equal(db.tables.payer_publish_requests.find((r) => r.listing_id === "L11").status, "waiting");
  });

  it("the daily safety net settles a signature whose follow-up never ran", async () => {
    const { db, documenso } = await openAddendum();
    documenso.complete("envelope_2", "2027-01-07T12:00:00.000Z");
    // The webhook's after-signing step failed: nothing settled.
    await applyEnvelope(db, documenso, await documenso.getEnvelope("envelope_2"), { storeSigned, onSigned: async () => { throw new Error("db down"); } });
    assert.equal(db.tables.payer_publish_requests.find((r) => r.listing_id === "L9").status, "waiting");
    const emails = [];
    const r = await settleStaleDocuments(db, { notify: async (landlordId, x) => emails.push([landlordId, x]), now: new Date("2027-02-01") });
    assert.equal(r.settled, 1);
    assert.equal(db.tables.payer_publish_requests.find((r) => r.listing_id === "L9").status, "approved");
    assert.deepEqual(emails[0][1].approved, ["900 Later Ln"]);
    assert.equal((await settleStaleDocuments(db, { now: new Date("2027-02-01") })).settled, 0, "safe to run again");
  });

  it("approveWaiting only approves what is covered", async () => {
    const db = world();
    await requestPayerCoverage(db, fakeDocumenso(), { landlordId: "pm1", listingIds: ["L2"] });
    const r = await approveWaiting(db, { landlordId: "pm1" });
    assert.deepEqual(r.approved, []);
    assert.equal(db.tables.payer_publish_requests[0].status, "waiting");
  });
});

describe("payer: one agreement for several accounts, then a change of signer", () => {
  it("cancels the shared master and says which other accounts were on it", async () => {
    const db = world();
    db.tables.billing_payers.push({ id: "link2", landlord_id: "pm2", payer_id: "own", listing_id: null, signer_name: "Jane Owner", signer_email: owner.email, status: "active", invited_at: "2026-11-09T00:00:00Z", created_at: "2026-11-09T00:01:00Z" });
    const documenso = fakeDocumenso();
    await signFor(db, documenso, "pm1", { accountIds: ["pm1", "pm2"] });
    const r = await changePayer(db, documenso, { landlord: pm, name: "New Signer", email: "new@signer.example.com" });
    assert.equal(db.tables.landlord_agreements[0].status, "voided");
    assert.deepEqual(r.cancelled, { payerId: "own", otherAccounts: ["pm2"] });
    assert.equal(r.link.signer_email, "new@signer.example.com");
  });

  it("a refused new signer leaves the old one and their document untouched", async () => {
    const db = world();
    const documenso = fakeDocumenso();
    await signFor(db, documenso, "pm1");
    await assert.rejects(() => changePayer(db, documenso, { landlord: pm, name: "Sam", email: "sam@wustl.edu" }), (e) => e.code === "payer_not_landlord");
    assert.equal(db.tables.billing_payers[0].status, "active");
    assert.equal(db.tables.landlord_agreements[0].status, "sent", "the old signer's document was not cancelled");
  });
});

describe("payer: covered but waiting on the signer's payment method", () => {
  it("is not shown as needing a signature", async () => {
    const { db } = await ownerSignedFor("pm1");
    db.tables.billing_settings = [{ key: "payment_method_required", value: true }];
    db.tables.payment_methods = [];
    await requestPayerCoverage(db, fakeDocumenso(), { landlordId: "pm1", listingIds: ["L2"], now: new Date("2027-02-01") });
    const [a] = await payerAccounts(db, "own", new Date("2027-02-01"));
    assert.equal(a.needs, null, "nothing to sign: L2 is covered");
    const view = await landlordPayerView(db, "pm1", new Date("2027-02-01"));
    assert.equal(view.approved[0].waitingFor, "payment_method", "approved, publishable once the signer adds a method");
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
    assert.deepEqual(a.drafts.map((d) => d.address), ["200 Draft Ave"], "the landlord's drafts are shown to the signer");
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
  it("the signer voids for one account: its properties come off, they stay assigned and show as declined", async () => {
    const { db, documenso } = await ownerSignedFor("pm1");
    const r = await endPayerFor(db, documenso, { payerId: "own", landlordId: "pm1" });
    assert.equal(r.released, 2);
    assert.equal(db.tables.billing_payers[0].status, "active", "still the account's authorized signer");
    assert.ok(db.tables.billing_payers[0].declined_at);
    const view = await landlordPayerView(db, "pm1", new Date("2027-02-01"));
    assert.equal(view.status, "declined");
    assert.equal(view.canChange, true, "nothing signed now: the landlord can change signer");
    assert.equal(db.tables.landlord_agreements[0].status, "signed");
    // An admin ending it ends the link too.
    await endPayerFor(db, documenso, { payerId: "own", landlordId: "pm1", endLink: true });
    assert.equal(db.tables.billing_payers[0].status, "ended");
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
    assert.match(body.drafted, /Once Jane Owner approves it, you can publish it/);
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

describe("payer: the admin's email lookup", () => {
  it("names an existing account, says a new one will be made, and refuses a student", async () => {
    const db = world();
    const existing = await lookupPayer(db, " Jane@Owner.example.com ");
    assert.equal(existing.status, "existing");
    assert.equal(existing.user.id, "own");
    assert.equal(existing.user.paysFor, 1);
    assert.equal((await lookupPayer(db, "nobody@new.example.com")).status, "new");
    assert.equal((await lookupPayer(db, "sam@wustl.edu")).status, "refused");
    assert.equal((await lookupPayer(db, "pat@pm.example.com")).status, "refused", "a landlord who has a payer can't pay for others");
    assert.equal((await lookupPayer(db, "not an email")).status, "invalid");
  });
});

describe("payer: nothing goes live without the signature and the signer's payment method", () => {
  const settings = [
    { key: "agreement_required", value: true },
    { key: "payment_method_required", value: true },
  ];
  it("a property the signer left off can't be published", async () => {
    const db = world();
    db.tables.billing_settings = settings;
    db.tables.payment_methods = [{ user_id: "own", status: "active", type: "us_bank_account", deleted_at: null }];
    const documenso = fakeDocumenso();
    await signFor(db, documenso, "pm1", { exhibit: [{ listingId: "L2", include: false, excluded: true }] });
    documenso.complete("envelope_1", "2027-01-05T12:00:00.000Z");
    await applyEnvelope(db, documenso, await documenso.getEnvelope("envelope_1"), { storeSigned });
    const gate = await checkListingGate(db, "pm1", { listingIds: ["L2"], now: new Date("2027-02-01") });
    assert.equal(gate.allowed, false);
    assert.deepEqual(gate.missing, ["agreement"]);
    assert.equal(gate.payer.name, "Jane Owner");
    const ok = await checkListingGate(db, "pm1", { listingIds: ["L1"], now: new Date("2027-02-01") });
    assert.equal(ok.allowed, true, "a covered one with the signer's payment method goes live");
  });

  it("the landlord's own card doesn't count: the signer's payment method is needed", async () => {
    const { db } = await ownerSignedFor("pm1");
    db.tables.billing_settings = settings;
    db.tables.payment_methods = [{ user_id: "pm1", status: "active", type: "card", exp_month: 12, exp_year: 2099, deleted_at: null }];
    const gate = await checkListingGate(db, "pm1", { listingIds: ["L1"], now: new Date("2027-02-01") });
    assert.equal(gate.allowed, false);
    assert.deepEqual(gate.missing, ["payment_method"]);
  });
});
