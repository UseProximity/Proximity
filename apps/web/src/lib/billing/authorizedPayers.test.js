/*
 * Run with: npm test (from apps/web).
 *
 * Signers and payers per account and per listing (Wyatt, 2026-11-25), against
 * the in-memory database and Documenso:
 *   - the account's signer covers a landlord's properties, but a property with
 *     its own signer is taken by that signer, each with their own addendum
 *   - an authorized payer is invoiced only once they accept; the listing's
 *     payer, then the account's, then whoever signs, then the landlord
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fakeDb, fakeDocumenso } from "./billingFakes.testutil.js";
import { applyEnvelope, coverageFor, coveringAgreement, startSigning } from "./agreements.js";
import { endPayerFor, landlordListingSignerViews, landlordPayerView, namePayer, payerAccounts, requestPayerCoverage } from "./payers.js";
import { acceptAuthorizedPayer, assignmentsFor, changeAuthorizedPayer, declineAuthorizedPayer, endAuthorizedPayer, landlordPayersView, nameAuthorizedPayer, payingFor, touchPayerInvite } from "./authorizedPayers.js";
import { billedTo, billingLinksFor } from "./payerLinks.js";
import { checkListingGate, coverageOnly, gateResponseBody } from "./listingGate.js";
import { createCharge, listChargesPaidBy } from "./charges.js";

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

const pm = { id: "pm", name: "Pat Manager", email: "pat@pm.example.com" };
const owner = { id: "own", name: "Olive Owner", email: "olive@owner.example.com" };
const acct = { id: "acc", name: "Ada Accountant", email: "ada@books.example.com" };

const listing = (id, address, published = true) => ({ id, address, published_at: published ? "2026-10-01T00:00:00Z" : null });
const unit = (id, listingId, name, published = true) => ({ id, listing_id: listingId, name, published_at: published ? "2026-10-01T00:00:00Z" : null });
const link = (over) => ({ landlord_id: "pm", listing_id: null, role: "signer", status: "active", invited_at: "2026-11-09T00:00:00Z", declined_at: null, accepted_at: null, created_at: "2026-11-09T00:00:00Z", ...over });
const oliveSigns = (listingId) => link({ id: `s-${listingId}`, payer_id: "own", listing_id: listingId, signer_name: "Olive Owner", signer_email: owner.email });

// Pat manages 100 Pat St and 300 Olive Ave (both live) and a draft, 500 Draft Ln.
function world(extra = {}) {
  return fakeDb({
    agreement_versions: [{ ...MASTER }, { ...AMENDMENT }],
    roles: [{ id: "r-landlord", name: "landlord" }],
    users: [
      { ...pm, roles: { name: "landlord" } },
      { ...owner, billing_only: true, roles: { name: "landlord" } },
      { ...acct, billing_only: true, roles: { name: "landlord" } },
      { id: "stu", name: "Sam Student", email: "sam@wustl.edu", roles: { name: "student" } },
    ],
    listing_landlords: [
      { user_id: "pm", listing_id: "L1" },
      { user_id: "pm", listing_id: "L3" },
      { user_id: "pm", listing_id: "L5" },
    ],
    listings: [listing("L1", "100 Pat St"), listing("L3", "300 Olive Ave"), listing("L5", "500 Draft Ln", false)],
    listing_units: [unit("U1", "L1", "Apt 1"), unit("U3", "L3", "Loft"), unit("U5", "L5", "Studio", false)],
    unit_leases: [],
    billing_payers: [],
    payer_publish_requests: [],
    payment_methods: [],
    charges: [],
    charge_status_history: [],
    ...extra,
  });
}

const storeSigned = async ({ userId }) => `billing/agreements/${userId}/signed.pdf`;
const signAs = (db, documenso, user, over = {}) => startSigning(db, documenso, { user, signerTitle: "Owner", signerName: user.name, authorized: true, ...over });
const complete = async (db, documenso, envelope) => {
  documenso.complete(envelope, "2027-01-05T12:00:00.000Z");
  return applyEnvelope(db, documenso, await documenso.getEnvelope(envelope), { storeSigned });
};
const later = new Date("2027-02-01");

describe("a signer for one listing", () => {
  it("the landlord's own document never has the listing someone else signs for", async () => {
    const db = world({ billing_payers: [oliveSigns("L3")] });
    const documenso = fakeDocumenso();
    await signAs(db, documenso, pm);
    assert.deepEqual(db.tables.agreement_coverage.map((c) => c.listing_id).sort(), ["L1", "L5"], "300 Olive Ave belongs on Olive's agreement");
    await complete(db, documenso, "envelope_1");
    const { covered } = await coverageFor(db, "pm", later);
    assert.deepEqual([...covered.keys()].sort(), ["L1", "L5"]);
  });

  it("the listing's signer signs for it alone, and each listing is covered by its own holder", async () => {
    const db = world({ billing_payers: [oliveSigns("L3")] });
    const documenso = fakeDocumenso();
    await signAs(db, documenso, pm);
    await complete(db, documenso, "envelope_1");
    await signAs(db, documenso, owner, { accountId: "pm" });
    const olives = db.tables.landlord_agreements.find((a) => a.user_id === "own");
    assert.deepEqual(db.tables.agreement_coverage.filter((c) => c.agreement_id === olives.id).map((c) => c.listing_id), ["L3"]);
    await complete(db, documenso, "envelope_2");
    const { covered, holderOf } = await coverageFor(db, "pm", later);
    assert.deepEqual([...covered.keys()].sort(), ["L1", "L3", "L5"]);
    assert.equal(holderOf("L3"), "own");
    assert.equal(holderOf("L1"), "pm");
    assert.equal((await coveringAgreement(db, "pm", "L3", later)).holderId, "own");
    assert.equal((await coveringAgreement(db, "pm", "L1", later)).holderId, "pm");
  });

  it("a listing's own signer takes it from the account's signer, and each has their own addendum open at once", async () => {
    const jane = { id: "jane", name: "Jane Signer", email: "jane@sign.example.com" };
    const db = world({ billing_payers: [link({ id: "acct-signer", payer_id: "jane", signer_name: "Jane Signer", signer_email: jane.email }), oliveSigns("L3")] });
    db.tables.users.push({ ...jane, billing_only: true, roles: { name: "landlord" } });
    // Both already hold a signed agreement, so what they sign next for Pat is an addendum each.
    db.tables.landlord_agreements = [
      { id: "mj", user_id: "jane", status: "signed", signed_at: "2026-12-05T00:00:00Z", term_start: "2026-12-05T00:00:00Z", version_id: "vm", signer_name: "Jane Signer", signer_details: { company: "" } },
      { id: "mo", user_id: "own", status: "signed", signed_at: "2026-12-05T00:00:00Z", term_start: "2026-12-05T00:00:00Z", version_id: "vm", signer_name: "Olive Owner", signer_details: { company: "" } },
    ];
    const documenso = fakeDocumenso();
    await signAs(db, documenso, jane, { accountId: "pm" });
    await signAs(db, documenso, owner, { accountId: "pm" });
    const open = db.tables.agreement_amendments.filter((a) => a.status === "sent");
    assert.deepEqual(open.map((a) => a.signer_id).sort(), ["jane", "own"], "one addendum in progress per signer");
    const onDoc = (signer) => db.tables.agreement_coverage.filter((c) => c.amendment_id === open.find((a) => a.signer_id === signer).id).map((c) => c.listing_id).sort();
    assert.deepEqual(onDoc("own"), ["L3"]);
    assert.ok(!onDoc("jane").includes("L3"), "the account's signer no longer holds 300 Olive Ave");
    assert.ok(onDoc("jane").includes("L1"));
  });

  it("a signer can add the drafts assigned to them, and only those", async () => {
    const db = world({ billing_payers: [oliveSigns("L5")] });
    const [account] = await payerAccounts(db, "own", later);
    assert.equal(account.listingsOnly, true);
    assert.deepEqual(account.drafts.map((d) => d.address), ["500 Draft Ln"]);
    assert.deepEqual(account.waiting, [], "Pat's live listings are not Olive's to sign");
  });

  it("publishing listings with different signers is never refused: each signer gets their own request", async () => {
    const db = world({ billing_payers: [oliveSigns("L3")] });
    db.tables.billing_settings = [{ key: "agreement_required", value: true }];
    const gate = await checkListingGate(db, "pm", { listingIds: ["L1", "L3"], now: later });
    assert.equal(gate.allowed, false);
    assert.deepEqual(gate.targets, ["L3"]);
    assert.deepEqual(gate.ownTargets, ["L1"]);
    assert.ok(coverageOnly(gate), "saved as drafts and sent on, not refused outright");
    const body = gateResponseBody(gate);
    assert.equal(body.uncovered.find((u) => u.listingId === "L3").signerName, "Olive Owner");
    assert.equal(body.uncovered.find((u) => u.listingId === "L1").signerName, null, "the landlord signs for this one");

    const sent = await requestPayerCoverage(db, fakeDocumenso(), { landlordId: "pm", listingIds: ["L1", "L3"] });
    assert.deepEqual(sent.own, ["L1"]);
    assert.equal(sent.bySigner.length, 1);
    assert.equal(sent.bySigner[0].link.payer_id, "own");
    assert.deepEqual(sent.bySigner[0].listingIds, ["L3"]);
    assert.deepEqual(db.tables.payer_publish_requests.map((r) => r.listing_id), ["L3"]);
  });

  it("a listing covered now needs a confirm to hand over, and is then uncovered until the new signer signs", async () => {
    const db = world();
    const documenso = fakeDocumenso();
    await signAs(db, documenso, pm);
    await complete(db, documenso, "envelope_1");
    assert.ok((await coverageFor(db, "pm", later)).covered.has("L3"));

    await assert.rejects(
      () => namePayer(db, { landlord: pm, name: "Olive Owner", email: owner.email, listingId: "L3", documenso, now: later }),
      (e) => e.code === "listing_covered" && /already covered under a marketing agreement/.test(e.message) && /until Olive Owner signs/.test(e.message)
    );
    assert.equal(db.tables.billing_payers.length, 0, "nothing changed without the confirm");

    const { link: made, uncovered } = await namePayer(db, { landlord: pm, name: "Olive Owner", email: owner.email, listingId: "L3", confirmUncover: true, documenso, now: later });
    assert.equal(made.listing_id, "L3");
    assert.equal(uncovered.released, 1);
    const { covered } = await coverageFor(db, "pm", later);
    assert.ok(!covered.has("L3"), "not covered until Olive signs");
    assert.ok(covered.has("L1"), "the landlord's other listings stay covered");
    const [card] = await landlordListingSignerViews(db, "pm", later);
    assert.equal(card.scope, "listing");
    assert.equal(card.listingAddress, "300 Olive Ave");
    assert.equal(card.status, "pending");
  });

  it("ending a listing's signer takes only that listing off their agreement", async () => {
    const db = world({ billing_payers: [oliveSigns("L3"), oliveSigns("L5")] });
    const documenso = fakeDocumenso();
    await signAs(db, documenso, owner, { accountId: "pm", listingIds: ["L5"] });
    await complete(db, documenso, "envelope_1");
    assert.deepEqual([...(await coverageFor(db, "pm", later)).covered.keys()].sort(), ["L3", "L5"]);
    const ended = await endPayerFor(db, documenso, { landlordId: "pm", listingId: "L3", reason: "revoked by the landlord", now: later });
    assert.equal(ended.released, 1);
    assert.deepEqual([...(await coverageFor(db, "pm", later)).covered.keys()], ["L5"], "the other listing they sign for is untouched");
    assert.deepEqual(db.tables.billing_payers.filter((l) => l.status === "active").map((l) => l.listing_id), ["L5"]);
  });

  it("the account card and the listing card each show only what that signer holds", async () => {
    const db = world({ billing_payers: [link({ id: "acct-signer", payer_id: "acc", signer_name: "Ada Accountant", signer_email: acct.email }), oliveSigns("L3")] });
    const account = await landlordPayerView(db, "pm", later);
    assert.equal(account.scope, "account");
    const [own] = await landlordListingSignerViews(db, "pm", later);
    assert.equal(own.payer.name, "Olive Owner");
    await requestPayerCoverage(db, fakeDocumenso(), { landlordId: "pm", listingIds: ["L3", "L5"] });
    assert.deepEqual((await landlordPayerView(db, "pm", later)).waiting.map((w) => w.address), ["500 Draft Ln"]);
    assert.deepEqual((await landlordListingSignerViews(db, "pm", later))[0].waiting.map((w) => w.address), ["300 Olive Ave"]);
  });
});

describe("an authorized payer", () => {
  const billed = async (db, listingId = null) => billedTo({ landlordId: "pm", listingId, ...(await billingLinksFor(db, "pm")) });

  it("is not billed until they accept", async () => {
    const db = world();
    const { link: made, created } = await nameAuthorizedPayer(db, { landlord: pm, name: "Ada Accountant", email: acct.email });
    assert.equal(created, false, "an existing billing account is reused");
    assert.equal(made.role, "payer");
    assert.equal((await billed(db)).via, "landlord", "pending: the landlord still pays");
    assert.equal((await landlordPayersView(db, "pm")).account.status, "pending");
    assert.equal((await payingFor(db, "acc"))[0].status, "pending");

    const before = await createCharge(db, { landlordId: "pm", amountCents: 50000, triggerType: "manual_test", listingId: "L1", createdByType: "admin", createdById: "admin1" });
    assert.equal(before.payer_id ?? null, null);

    await acceptAuthorizedPayer(db, { userId: "acc", linkId: made.id, now: later });
    assert.deepEqual({ userId: (await billed(db)).userId, via: (await billed(db)).via }, { userId: "acc", via: "payer" });
    const after = await createCharge(db, { landlordId: "pm", amountCents: 50000, triggerType: "manual_test", listingId: "L1", createdByType: "admin", createdById: "admin1" });
    assert.equal(after.payer_id, "acc", "charges made after they accept are theirs");
    assert.equal(db.tables.charges.find((c) => c.id === before.id).payer_id ?? null, null, "a charge already made never moves");
  });

  it("a new email gets a billing-only account", async () => {
    const db = world();
    const { payer, created } = await nameAuthorizedPayer(db, { landlord: pm, name: "New Person", email: "New@Payer.Example.com" });
    assert.equal(created, true);
    assert.equal(db.tables.users.find((u) => u.id === payer.id).billing_only, true);
    assert.equal(db.tables.billing_payers[0].signer_email, "new@payer.example.com");
  });

  it("who is invoiced: the listing's payer, then the account's, then whoever signs, then the landlord", async () => {
    const db = world({ billing_payers: [oliveSigns("L3")] });
    assert.deepEqual([(await billed(db, "L3")).userId, (await billed(db, "L3")).via], ["own", "signer"]);
    assert.equal((await billed(db, "L1")).via, "landlord");

    const account = await nameAuthorizedPayer(db, { landlord: pm, name: "Ada Accountant", email: acct.email });
    await acceptAuthorizedPayer(db, { userId: "acc", linkId: account.link.id });
    assert.equal((await billed(db, "L3")).userId, "acc", "a named payer beats a signer who only pays by default");
    assert.equal((await billed(db, "L1")).userId, "acc");

    db.tables.users.push({ id: "tom", name: "Tom Treasurer", email: "tom@books.example.com", billing_only: true, roles: { name: "landlord" } });
    const own = await nameAuthorizedPayer(db, { landlord: pm, name: "Tom Treasurer", email: "tom@books.example.com", listingId: "L3" });
    assert.equal((await billed(db, "L3")).userId, "acc", "the listing's payer has not accepted yet");
    await acceptAuthorizedPayer(db, { userId: "tom", linkId: own.link.id });
    assert.equal((await billed(db, "L3")).userId, "tom");
    assert.equal((await billed(db, "L1")).userId, "acc");

    const who = await assignmentsFor(db, "pm", later);
    const row = (id) => who.listings.find((l) => l.listingId === id);
    assert.deepEqual(row("L3").signs, { name: "Olive Owner", via: "listing" });
    assert.deepEqual(row("L3").pays, { name: "Tom Treasurer", via: "listing_payer" });
    assert.deepEqual(row("L1").signs, { name: null, via: "landlord" });
    assert.deepEqual(row("L1").pays, { name: "Ada Accountant", via: "account_payer" });
  });

  it("can decline before accepting, never after; the landlord can always remove them", async () => {
    const db = world();
    const first = await nameAuthorizedPayer(db, { landlord: pm, name: "Ada Accountant", email: acct.email });
    await declineAuthorizedPayer(db, { userId: "acc", linkId: first.link.id });
    assert.equal(db.tables.billing_payers[0].status, "ended");
    assert.equal((await landlordPayersView(db, "pm")).account, null);

    const second = await nameAuthorizedPayer(db, { landlord: pm, name: "Ada Accountant", email: acct.email });
    await acceptAuthorizedPayer(db, { userId: "acc", linkId: second.link.id });
    await assert.rejects(() => declineAuthorizedPayer(db, { userId: "acc", linkId: second.link.id }), (e) => e.code === "already_accepted");
    await assert.rejects(() => acceptAuthorizedPayer(db, { userId: "own", linkId: second.link.id }), (e) => e.code === "no_invite", "only the person named can answer");
    await endAuthorizedPayer(db, { landlordId: "pm", linkId: second.link.id });
    assert.equal((await billed(db)).via, "landlord");
  });

  it("refuses your own email, students, a second payer on the same level, the signer who already pays, and chains", async () => {
    const db = world({ billing_payers: [oliveSigns("L3")] });
    await assert.rejects(() => nameAuthorizedPayer(db, { landlord: pm, name: "Pat", email: "PAT@pm.example.com" }), (e) => e.code === "payer_is_you");
    await assert.rejects(() => nameAuthorizedPayer(db, { landlord: pm, name: "Sam", email: "sam@wustl.edu" }), (e) => e.code === "payer_not_landlord");
    await assert.rejects(() => nameAuthorizedPayer(db, { landlord: pm, name: "Olive Owner", email: owner.email, listingId: "L3" }), (e) => e.code === "already_pays");
    await assert.rejects(() => nameAuthorizedPayer(db, { landlord: pm, name: "Ada", email: acct.email, listingId: "nope" }), (e) => e.code === "not_your_listing");
    await nameAuthorizedPayer(db, { landlord: pm, name: "Ada Accountant", email: acct.email });
    await assert.rejects(() => nameAuthorizedPayer(db, { landlord: pm, name: "Olive Owner", email: owner.email }), (e) => e.code === "payer_exists");
    // Pat has a payer, so Pat can't be someone else's; Ada pays for Pat, so Ada can't name one.
    await assert.rejects(() => nameAuthorizedPayer(db, { landlord: owner, name: "Pat Manager", email: pm.email }), (e) => e.code === "payer_has_payer");
    await assert.rejects(() => nameAuthorizedPayer(db, { landlord: acct, name: "Olive Owner", email: owner.email }), (e) => e.code === "you_pay_for_others");
  });

  it("changing the payer ends the old one; a refused change leaves them in place", async () => {
    const db = world();
    const first = await nameAuthorizedPayer(db, { landlord: pm, name: "Ada Accountant", email: acct.email });
    await assert.rejects(() => changeAuthorizedPayer(db, { landlord: pm, linkId: first.link.id, name: "Sam", email: "sam@wustl.edu" }), (e) => e.code === "payer_not_landlord");
    assert.equal(db.tables.billing_payers.find((l) => l.id === first.link.id).status, "active");
    const { link: next } = await changeAuthorizedPayer(db, { landlord: pm, linkId: first.link.id, name: "Olive Owner", email: owner.email });
    assert.equal(db.tables.billing_payers.find((l) => l.id === first.link.id).status, "ended");
    assert.equal(next.payer_id, "own");
  });

  it("the invite can be sent again only after 30 minutes, and not once accepted", async () => {
    const db = world();
    const now = new Date("2027-01-01T12:00:00Z");
    const { link: made } = await nameAuthorizedPayer(db, { landlord: pm, name: "Ada Accountant", email: acct.email, now });
    await assert.rejects(() => touchPayerInvite(db, { landlordId: "pm", linkId: made.id, now: new Date("2027-01-01T12:10:00Z") }), (e) => e.code === "too_soon");
    await touchPayerInvite(db, { landlordId: "pm", linkId: made.id, now: new Date("2027-01-01T12:31:00Z") });
    await acceptAuthorizedPayer(db, { userId: "acc", linkId: made.id });
    await assert.rejects(() => touchPayerInvite(db, { landlordId: "pm", linkId: made.id, now: new Date("2027-01-02T12:31:00Z") }), (e) => e.code === "already_accepted");
  });

  it("can approve or dispute the charges billed to them; a signer who pays by default cannot", async () => {
    const db = world({ billing_payers: [oliveSigns("L3")] });
    const account = await nameAuthorizedPayer(db, { landlord: pm, name: "Ada Accountant", email: acct.email });
    await acceptAuthorizedPayer(db, { userId: "acc", linkId: account.link.id });
    db.tables.charges.push(
      { id: "c-payer", landlord_id: "pm", payer_id: "acc", amount_cents: 1000, trigger_type: "manual_test", status: "pending", created_at: "2027-01-02T00:00:00Z" },
      { id: "c-signer", landlord_id: "pm", payer_id: "own", amount_cents: 1000, trigger_type: "manual_test", status: "pending", created_at: "2027-01-02T00:00:00Z" }
    );
    const [mine] = await listChargesPaidBy(db, "acc", later);
    assert.equal(mine.actions.approve, true);
    assert.equal(mine.actions.contest, true);
    const [signers] = await listChargesPaidBy(db, "own", later);
    assert.deepEqual(signers.actions, { approve: false, contest: false, contactForDispute: false });
  });

  it("when a payment method is required, the payer's is the one that counts", async () => {
    const db = world();
    db.tables.billing_settings = [{ key: "payment_method_required", value: true }];
    db.tables.payment_methods = [{ id: "m1", user_id: "pm", status: "active", type: "us_bank_account", deleted_at: null }];
    assert.equal((await checkListingGate(db, "pm", { listingIds: ["L1"], now: later })).allowed, true, "the landlord pays, and has a method");

    const { link: made } = await nameAuthorizedPayer(db, { landlord: pm, name: "Ada Accountant", email: acct.email });
    assert.equal((await checkListingGate(db, "pm", { listingIds: ["L1"], now: later })).allowed, true, "still the landlord's until the payer accepts");
    await acceptAuthorizedPayer(db, { userId: "acc", linkId: made.id });
    const gate = await checkListingGate(db, "pm", { listingIds: ["L1"], now: later });
    assert.deepEqual(gate.missing, ["payment_method"]);
    assert.deepEqual(gate.methodWaitsOn.map((w) => w.name), ["Ada Accountant"]);
    db.tables.payment_methods.push({ id: "m2", user_id: "acc", status: "active", type: "us_bank_account", deleted_at: null });
    assert.equal((await checkListingGate(db, "pm", { listingIds: ["L1"], now: later })).allowed, true);
  });
});
