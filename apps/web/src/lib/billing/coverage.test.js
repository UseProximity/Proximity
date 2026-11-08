/*
 * Run with: npm test (from apps/web).
 *
 * Coverage: one master agreement with an Exhibit A of covered properties, and
 * Exhibit A amendments for properties added later (decisions of 2026-11-04).
 * Against the in-memory database and Documenso in billingFakes.testutil.js, which
 * apply the same "only a signed document covers a property" rule as the database.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { fakeDb, fakeDocumenso } from "./billingFakes.testutil.js";
import { applyEnvelope, cleanSignerDetails, cleanSignerName, coverageFor, coverageLine, exhibitText, documentFileKeys, coveringAgreement, markAgreementSigned, startSigning, summarizeAgreementRows, voidAgreement, voidDocument } from "./agreements.js";
import { coveredMap, coversProperty, displayAddress, exhibitChoice, missingUnits, planCoverage, uncoveredAmong } from "./coverage.js";
import { buildExhibitPdf, pdfSafe } from "./exhibitPdf.js";
import { exhibitPreview } from "./exhibitUnits.js";
import { mergePdfs, mergeSignedParts } from "./agreementPdf.js";
import { formatRate, getLiveVersion, publishVersion } from "./agreementVersions.js";
import { gateDecision, gateMessage } from "./listingGate.js";

const MASTER = {
  id: "vm",
  label: "Agreement 2027",
  kind: "master",
  landlord_id: null,
  status: "live",
  requires_resign: false,
  published_at: "2026-12-01T00:00:00Z",
  commission_rate_percent: 8.5,
  provider_template_id: "envelope_master",
  provider_recipient_id: 11,
  provider_title_field_id: 42,
  provider_rate_field_id: 43,
};
const AMENDMENT = { ...MASTER, id: "va", label: "Amendment 2027", kind: "amendment", provider_template_id: "envelope_amend", provider_rate_field_id: null };
const user = { id: "u1", name: "Pat Landlord", email: "pat@example.com" };

const listing = (id, address, published = true) => ({ id, address: `${address}, St. Louis, Missouri 63130, United States`, published_at: published ? "2026-10-01T00:00:00Z" : null });
const unit = (id, listingId, name, published = true) => ({ id, listing_id: listingId, name, published_at: published ? "2026-10-01T00:00:00Z" : null });

// Pat owns 100 Live St (live), and two drafts, 200 Draft Ave and 300 Draft Ave.
function world(extra = {}) {
  return fakeDb({
    agreement_versions: [{ ...MASTER }, { ...AMENDMENT }],
    users: [{ id: "u1", name: "Pat Landlord", company_name: "Pat Rentals LLC", email: "pat@example.com" }],
    listing_landlords: [
      { user_id: "u1", listing_id: "L1" },
      { user_id: "u1", listing_id: "L2" },
      { user_id: "u1", listing_id: "L3" },
    ],
    listings: [listing("L1", "100 Live St"), listing("L2", "200 Draft Ave", false), listing("L3", "300 Draft Ave", false), listing("L4", "400 New Rd", false)],
    listing_units: [unit("U1", "L1", "Apt 1"), unit("U2", "L1", "Apt 2"), unit("U3", "L2", "Studio", false), unit("U4", "L3", "Loft", false)],
    unit_leases: [],
    ...extra,
  });
}
// Drafts go on Exhibit A unless taken off (2026-11-07). These tests take the drafts
// off unless they are the ones being published (a published one cannot be taken off),
// so each document lists the live property and what is being published.
const DRAFTS_OFF = ["L2", "L3", "L4"].map((listingId) => ({ listingId, include: false }));
const sign = (db, documenso, over = {}) => startSigning(db, documenso, { user, signerTitle: "Owner", authorized: true, exhibit: DRAFTS_OFF, ...over });
const storeSigned = async ({ userId }) => `billing/agreements/${userId}/signed.pdf`;
const ids = (entries) => entries.map((e) => e.listingId);
const coverage = (db, status) => db.tables.agreement_coverage.filter((r) => !status || r.status === status);

describe("planCoverage (the pure rule)", () => {
  const properties = [
    { listingId: "L1", address: "100 Live St", units: ["Apt 1"], live: true },
    { listingId: "L2", address: "200 Draft Ave", units: [], live: false },
    { listingId: "L3", address: "300 Draft Ave", units: [], live: false },
  ];

  it("with no master: everything live plus what is being published, nothing else", () => {
    const plan = planCoverage({ properties, rows: [], master: null, masterValid: false, requestedIds: ["L2"] });
    assert.equal(plan.kind, "master");
    assert.deepEqual(ids(plan.entries), ["L1", "L2"]);
  });

  it("ignores properties the landlord has no stake in", () => {
    const plan = planCoverage({ properties, rows: [], master: null, masterValid: false, requestedIds: ["someone-elses"] });
    assert.deepEqual(ids(plan.entries), ["L1"]);
  });

  it("with a master that counts: an amendment adding only what is not covered", () => {
    const master = { id: "m1" };
    const rows = [{ listing_id: "L1", address: "100 Live St", units: ["Apt 1"], agreement_id: "m1", status: "covered" }];
    const plan = planCoverage({ properties, rows, master, masterValid: true, requestedIds: ["L2", "L3"] });
    assert.equal(plan.kind, "amendment");
    assert.deepEqual(ids(plan.previous), ["L1"]);
    assert.deepEqual(ids(plan.entries), ["L1", "L2", "L3"]);
    assert.deepEqual(ids(plan.added), ["L2", "L3"]);
  });

  it("nothing to sign when every requested property is covered", () => {
    const rows = [{ listing_id: "L1", address: "100 Live St", agreement_id: "m1", status: "covered" }];
    assert.equal(planCoverage({ properties, rows, master: { id: "m1" }, masterValid: true, requestedIds: ["L1"] }).kind, "none");
  });

  it("a proposed (unsigned) row covers nothing", () => {
    const rows = [{ listing_id: "L1", address: "100 Live St", agreement_id: "m1", status: "proposed" }];
    assert.equal(coveredMap(rows, { master: { id: "m1" }, masterValid: true }).size, 0);
  });

  it("a lapsed master carries what it covered into the new one", () => {
    const rows = [{ listing_id: "L1", address: "100 Live St", agreement_id: "m1", status: "covered" }];
    const gone = properties.map((p) => ({ ...p, live: false }));
    const plan = planCoverage({ properties: gone, rows, master: { id: "m1" }, masterValid: false });
    assert.equal(plan.kind, "master");
    assert.deepEqual(ids(plan.entries), ["L1"]);
  });

  it("an uncovered live property left off, with nothing else to add: nothing to sign, withdrawn at once", () => {
    const plan = planCoverage({ properties, rows: [], master: { id: "m1" }, masterValid: true, selections: new Map([["L1", { include: false, excluded: true }]]) });
    assert.equal(plan.kind, "none");
    assert.deepEqual(plan.withdraw, ["L1"]);
  });

  it("keeps what a replaced copy proposed (carry)", () => {
    const plan = planCoverage({ properties, rows: [], master: null, masterValid: false, requestedIds: ["L3"], carry: [{ listingId: "L2" }] });
    assert.deepEqual(ids(plan.entries), ["L1", "L2", "L3"]);
  });
});

describe("master agreement with Exhibit A", () => {
  it("publishing two drafts: one master listing the live property and both drafts, units included", async () => {
    const db = world();
    const documenso = fakeDocumenso();
    const r = await sign(db, documenso, { listingIds: ["L2", "L3"] });
    assert.equal(r.kind, "master");
    const row = db.tables.landlord_agreements[0];
    assert.deepEqual(ids(row.exhibit), ["L1", "L2", "L3"]);
    assert.equal(row.exhibit[0].wholeBuilding, true, "a property they own: the whole building by default");
    assert.equal(row.exhibit[0].address, "100 Live St, St. Louis, Missouri 63130");
    assert.equal(row.commission_rate_percent, 8.5);
    // The copy: one document, Exhibit A in its own box, the title filled in.
    const copy = documenso.calls.lastCopy;
    assert.equal(copy.exhibit, null);
    assert.match(copy.prefill.find((p) => p.id === 2).value, /^100 Live St, St\. Louis, Missouri 63130\nWhole building\n\n200 Draft Ave[\s\S]*300 Draft Ave/);
    assert.equal(copy.prefill.some((p) => p.id === 43), false, "the rate is in the agreement's text, no box is filled");
    assert.equal(copy.dropRateBox, true, "a leftover rate box is taken off the copy");
    assert.equal(copy.signerTitle, "Owner");
    // Proposed, not covered, until signed.
    assert.deepEqual(coverage(db).map((c) => c.status), ["proposed", "proposed", "proposed"]);
    const { covered } = await coverageFor(db, "u1");
    assert.equal(covered.size, 0, "an unsigned master covers nothing");
  });

  it("signing it covers every property on Exhibit A, with no end date", async () => {
    const db = world();
    const documenso = fakeDocumenso();
    await sign(db, documenso, { listingIds: ["L2"] });
    documenso.complete("envelope_1", "2027-01-05T12:00:00.000Z");
    assert.equal(await applyEnvelope(db, documenso, await documenso.getEnvelope("envelope_1"), { storeSigned }), "signed");
    const row = db.tables.landlord_agreements[0];
    assert.equal(row.term_start, "2027-01-05T12:00:00.000Z");
    assert.equal(row.term_end, undefined);
    assert.ok(row.signed_file_key, "the signed agreement, Exhibit A inside it, is stored");
    const { covered } = await coverageFor(db, "u1", new Date("2027-02-01"));
    assert.deepEqual([...covered.keys()].sort(), ["L1", "L2"]);
    // Years later it still counts: nothing to sign again.
    const later = await coverageFor(db, "u1", new Date("2028-01-06"));
    assert.equal(later.state.expired, false);
    assert.deepEqual([...later.covered.keys()].sort(), ["L1", "L2"]);
  });

  it("a declined master releases the properties it proposed", async () => {
    const db = world();
    const documenso = fakeDocumenso();
    await sign(db, documenso, { listingIds: ["L2"] });
    documenso.reject("envelope_1", "Rate too high");
    assert.equal(await applyEnvelope(db, documenso, await documenso.getEnvelope("envelope_1")), "declined");
    assert.deepEqual(coverage(db).map((c) => c.status), ["released", "released"]);
  });

  it("the database refuses to cover a property with an unsigned document", async () => {
    const db = world();
    await sign(db, fakeDocumenso(), { listingIds: ["L2"] });
    const { error } = await db.from("agreement_coverage").update({ status: "covered", covered_at: "2027-01-01" }).eq("listing_id", "L2");
    assert.equal(error?.code, "23514");
  });
});

describe("Exhibit A amendments", () => {
  async function signedMaster() {
    const db = world();
    const documenso = fakeDocumenso();
    await sign(db, documenso, { listingIds: ["L2"] });
    documenso.complete("envelope_1", "2027-01-05T12:00:00.000Z");
    await applyEnvelope(db, documenso, await documenso.getEnvelope("envelope_1"), { storeSigned });
    return { db, documenso };
  }

  it("Continue signing from Billing (no ids) picks up an addendum in progress instead of saying it is signed", async () => {
    const { db, documenso } = await signedMaster();
    await sign(db, documenso, { listingIds: ["L3"], now: new Date("2027-02-01") });
    const preview = await exhibitPreview(db, "u1", { listingIds: [], now: new Date("2027-02-01") });
    assert.equal(preview.kind, "amendment");
    assert.equal(preview.properties.find((p) => p.listingId === "L3").locked, true, "the property being added stays on");
  });

  it("publishing a new property later: a separate Exhibit A amendment showing the list before and after", async () => {
    const { db, documenso } = await signedMaster();
    const r = await sign(db, documenso, { listingIds: ["L3"], now: new Date("2027-02-01") });
    assert.equal(r.kind, "amendment");
    const a = db.tables.agreement_amendments[0];
    assert.deepEqual(ids(a.previous_exhibit), ["L1", "L2"]);
    assert.deepEqual(ids(a.proposed_exhibit), ["L1", "L2", "L3"]);
    assert.equal(a.version_id, "va", "the live amendment template");
    assert.equal(documenso.calls.lastCopy.templateId, "envelope_amend");
    assert.equal(documenso.calls.lastCopy.exhibit, null, "one document: the lists are in its Exhibit A box");
    assert.equal(documenso.calls.lastCopy.title, "Exhibit A amendment");
    // L3 is only proposed until the amendment is signed.
    const before = await coverageFor(db, "u1", new Date("2027-02-01"));
    assert.equal(before.covered.has("L3"), false);
    documenso.complete("envelope_2", "2027-02-02T00:00:00.000Z");
    assert.equal(await applyEnvelope(db, documenso, await documenso.getEnvelope("envelope_2"), { storeSigned }), "signed");
    const after = await coverageFor(db, "u1", new Date("2027-02-03"));
    assert.deepEqual([...after.covered.keys()].sort(), ["L1", "L2", "L3"]);
    // The master is untouched: one signature, same term.
    assert.equal(db.tables.landlord_agreements.filter((m) => m.status === "signed").length, 1);
    // The amendment is its own signed document; the agreement keeps its own files untouched.
    const a2 = db.tables.agreement_amendments[0];
    assert.ok(a2.signed_file_key);
    assert.deepEqual(await documentFileKeys(db, { userId: "u1", kind: "amendment", id: a2.id }), [a2.signed_file_key]);
  });

  it("a charge on a covered property records the agreement and amendment that cover it, with the rate", async () => {
    const { db, documenso } = await signedMaster();
    await sign(db, documenso, { listingIds: ["L3"], now: new Date("2027-02-01") });
    assert.equal(await coveringAgreement(db, "u1", "L3", new Date("2027-02-01")), null, "not covered while the amendment is unsigned");
    documenso.complete("envelope_2", "2027-02-02T00:00:00.000Z");
    await applyEnvelope(db, documenso, await documenso.getEnvelope("envelope_2"), { storeSigned });
    const c = await coveringAgreement(db, "u1", "L3", new Date("2027-02-03"));
    assert.equal(c.agreementId, db.tables.landlord_agreements[0].id);
    assert.equal(c.amendmentId, db.tables.agreement_amendments[0].id);
    assert.equal(c.commissionRatePercent, 8.5);
    assert.equal((await coveringAgreement(db, "u1", "L1", new Date("2027-02-03"))).amendmentId, null, "a property on the master itself");
  });

  it("a new unit at a covered address needs nothing", async () => {
    const { db, documenso } = await signedMaster();
    db.tables.listing_units.push(unit("U9", "L1", "Apt 3", false));
    assert.deepEqual(await sign(db, documenso, { listingIds: ["L1"], now: new Date("2027-02-01") }), { alreadySigned: true });
  });

  it("publishing another property before signing replaces the amendment with one covering both", async () => {
    const { db, documenso } = await signedMaster();
    db.tables.listing_landlords.push({ user_id: "u1", listing_id: "L4" });
    await sign(db, documenso, { listingIds: ["L3"], now: new Date("2027-02-01") });
    const r = await sign(db, documenso, { listingIds: ["L4"], now: new Date("2027-02-01") });
    assert.equal(r.kind, "amendment");
    assert.deepEqual(documenso.calls.cancelled, ["envelope_2"]);
    const [first, second] = db.tables.agreement_amendments;
    assert.equal(first.status, "voided");
    assert.equal(second.status, "sent");
    assert.deepEqual(ids(second.proposed_exhibit), ["L1", "L2", "L3", "L4"]);
    assert.deepEqual(coverage(db, "proposed").map((c) => c.listing_id).sort(), ["L3", "L4"]);
  });

  it("asking again for the same property reuses the copy in progress", async () => {
    const { db, documenso } = await signedMaster();
    await sign(db, documenso, { listingIds: ["L3"], now: new Date("2027-02-01") });
    const again = await sign(db, documenso, { listingIds: ["L3"], now: new Date("2027-02-01") });
    assert.equal(again.token, "token_2");
    assert.equal(documenso.calls.copies, 2);
  });

  it("a declined amendment leaves the new property uncovered and the master as it was", async () => {
    const { db, documenso } = await signedMaster();
    await sign(db, documenso, { listingIds: ["L3"], now: new Date("2027-02-01") });
    documenso.reject("envelope_2", "Not this one");
    const told = [];
    await applyEnvelope(db, documenso, await documenso.getEnvelope("envelope_2"), { notify: { declined: async (x) => told.push(x) } });
    assert.equal(told[0].kind, "amendment");
    const { covered } = await coverageFor(db, "u1", new Date("2027-02-03"));
    assert.deepEqual([...covered.keys()].sort(), ["L1", "L2"]);
  });

  it("needs a live amendment version", async () => {
    const { db, documenso } = await signedMaster();
    db.tables.agreement_versions = db.tables.agreement_versions.filter((v) => v.kind !== "amendment");
    await assert.rejects(() => sign(db, documenso, { listingIds: ["L3"], now: new Date("2027-02-01") }), (e) => e.code === "not_available" && /amendment/.test(e.message));
  });

  it("prepares the copy first, then the call with the license answer opens it (2026-11-05)", async () => {
    const { db, documenso } = await signedMaster();
    const ready = await sign(db, documenso, { listingIds: ["L3"], now: new Date("2027-02-01"), prepare: true });
    assert.deepEqual(ready, { prepared: true, kind: "amendment" });
    assert.equal((await documenso.getEnvelope("envelope_2")).status, "PENDING", "opened while they answer");
    const opened = await sign(db, documenso, { listingIds: ["L3"], now: new Date("2027-02-01"), licenseDisclosure: { is_licensee: false } });
    assert.equal(opened.token, "token_2");
    assert.equal(documenso.calls.copies, 2, "the prepared copy is the one opened");
  });

  it("a copy prepared on an earlier day is replaced, so its dates are today's", async () => {
    const { db, documenso } = await signedMaster();
    await sign(db, documenso, { listingIds: ["L3"], now: new Date("2027-02-01T18:00:00Z"), prepare: true });
    const r = await sign(db, documenso, { listingIds: ["L3"], now: new Date("2027-02-03T18:00:00Z") });
    assert.equal(r.token, "token_3");
    assert.deepEqual(documenso.calls.cancelled, ["envelope_2"]);
  });

  it("a new master signed after a re-sign carries the covered properties and ends an open amendment", async () => {
    const { db, documenso } = await signedMaster();
    await sign(db, documenso, { listingIds: ["L3"], now: new Date("2027-02-01") });
    // A new standard master that everyone must sign again.
    db.tables.agreement_versions.find((v) => v.id === "vm").status = "retired";
    db.tables.agreement_versions.push({ ...MASTER, id: "vm2", label: "Agreement 2028", requires_resign: true, published_at: "2027-03-01T00:00:00Z", provider_template_id: "envelope_master2" });
    const r = await sign(db, documenso, { now: new Date("2027-03-02") });
    assert.equal(r.kind, "master");
    assert.equal(db.tables.agreement_amendments[0].status, "voided", "the amendment to the old master is ended");
    const fresh = db.tables.landlord_agreements.find((m) => m.version_id === "vm2");
    assert.deepEqual(ids(fresh.exhibit), ["L1", "L2", "L3"], "covered properties and the one being added carry over");
  });
});

describe("negotiated versions", () => {
  it("a landlord's own live version is used instead of the standard one", async () => {
    const db = world();
    db.tables.agreement_versions.push({ ...MASTER, id: "vneg", landlord_id: "u1", provider_template_id: "envelope_neg", commission_rate_percent: 6 });
    assert.equal((await getLiveVersion(db, { kind: "master", landlordId: "u1" })).id, "vneg");
    assert.equal((await getLiveVersion(db, { kind: "master", landlordId: "u2" })).id, "vm");
    const documenso = fakeDocumenso();
    await sign(db, documenso);
    assert.equal(documenso.calls.lastCopy.templateId, "envelope_neg");
    assert.equal(db.tables.landlord_agreements[0].commission_rate_percent, 6, "its rate is kept for invoices");
  });

  it("a negotiated signature is flagged, not invalidated, when the standard version asks everyone to re-sign", () => {
    const rows = [{ status: "signed", agreement_version: { landlord_id: "u1", published_at: "2026-12-01" } }];
    const state = summarizeAgreementRows(rows, { cutoff: "2027-01-01" });
    assert.equal(state.valid, true);
    assert.equal(state.flaggedForReview, true);
    const standard = summarizeAgreementRows([{ status: "signed", agreement_version: { landlord_id: null, published_at: "2026-12-01" } }], { cutoff: "2027-01-01" });
    assert.equal(standard.valid, false);
    assert.equal(standard.needsResign, true);
  });

  it("an amendment version never asks anyone to re-sign; each kind keeps its own live version", async () => {
    const db = world();
    db.tables.agreement_versions.push({ ...AMENDMENT, id: "va2", status: "ready", published_at: null });
    const v = await publishVersion(db, { versionId: "va2", adminId: "a" });
    assert.equal(v.requires_resign, false);
    assert.deepEqual(db.tables.agreement_versions.map((x) => `${x.id}:${x.status}`), ["vm:live", "va:retired", "va2:live"]);
  });
});

describe("Addendum to Exhibit A from the agreement's saved details (2026-11-07)", () => {
  it("fills the signature block from the agreement, lists only what it adds, with the agreement's date", async () => {
    const db = world();
    const documenso = fakeDocumenso();
    await sign(db, documenso, {
      listingIds: ["L2"],
      signerName: "Pat Landlord",
      signerCompany: "Pat Rentals LLC",
      signerEmail: "leasing@patrentals.com",
      signerAddress1: "8151 Clayton Rd",
      signerAddress2: "Suite 301",
      signerCity: "St. Louis, MO 63117",
    });
    assert.deepEqual(db.tables.landlord_agreements[0].signer_details, {
      company: "Pat Rentals LLC",
      email: "leasing@patrentals.com",
      street: "8151 Clayton Rd",
      suite: "Suite 301",
      city: "St. Louis, MO 63117",
    });
    documenso.complete("envelope_1", "2027-01-05T18:00:00.000Z");
    await applyEnvelope(db, documenso, await documenso.getEnvelope("envelope_1"), { storeSigned });
    const t = (id, label) => ({ id, type: "TEXT", recipientId: 11, fieldMeta: { label } });
    documenso.envelopes.set("envelope_amend", {
      id: "envelope_amend",
      recipients: [{ id: 11, role: "SIGNER" }],
      fields: [{ id: 1, type: "SIGNATURE", recipientId: 11 }, t(2, "EXHIBIT A"), t(3, "AGREEMENT DATE"), t(4, "COMPANY NAME"), t(5, "REPRESENTATIVE NAME"), t(6, "ADDRESS 1"), t(7, "ADDRESS 2"), t(8, "EMAIL")],
    });
    // Nothing asked: no name, title, authorisation or address sent.
    const r = await startSigning(db, documenso, { user, fromAgreement: true, listingIds: ["L3"], now: new Date("2027-02-01T18:00:00Z") });
    assert.equal(r.kind, "amendment");
    const v = (id) => documenso.calls.lastCopy.prefill.find((p) => p.id === id)?.value;
    assert.equal(v(2), "300 Draft Ave, St. Louis, Missouri 63130\nWhole building");
    assert.equal(v(3), "01/05/2027", "the agreement's date, not today's");
    assert.equal(v(4), "Pat Rentals LLC");
    assert.equal(v(5), "Pat Landlord");
    assert.equal(v(6), "8151 Clayton Rd, Suite 301");
    assert.equal(v(7), "St. Louis, MO 63117");
    assert.equal(v(8), "leasing@patrentals.com");
    assert.equal(documenso.calls.lastCopy.signerTitle, "Owner");
  });

  it("an agreement (not an addendum) still asks for the details", async () => {
    await assert.rejects(() => startSigning(world(), fakeDocumenso(), { user, fromAgreement: true }), (e) => e.code === "details_required");
  });
});

describe("Exhibit A by whole building or units (2026-11-07)", () => {
  // Pat rents units 1A and 1B in someone else's building, L5 (2C is not theirs yet).
  const u5 = (id, name) => ({ id, listing_id: "L5", name, published_at: "2026-10-01T00:00:00Z", deleted_at: null });
  const lease = (id, unit) => ({ id, owner_id: "u1", published_at: "2026-10-01T00:00:00Z", deleted_at: null, listing_units: unit });
  function renter() {
    const db = world();
    db.tables.listings.push(listing("L5", "500 Shared Blvd"));
    db.tables.unit_leases.push(lease("Q1", u5("U51", "1A")), lease("Q2", u5("U52", "1B")));
    return db;
  }

  it("a renter's building lists their units, and they cannot choose the whole building", async () => {
    const db = renter();
    const documenso = fakeDocumenso();
    await sign(db, documenso, { exhibit: [...DRAFTS_OFF, { listingId: "L5", wholeBuilding: true }] });
    const entry = db.tables.landlord_agreements[0].exhibit.find((e) => e.listingId === "L5");
    assert.deepEqual(entry, { listingId: "L5", address: "500 Shared Blvd, St. Louis, Missouri 63130", wholeBuilding: false, units: ["1A", "1B"], unitIds: ["U51", "U52"] });
    const row = db.tables.agreement_coverage.find((c) => c.listing_id === "L5");
    assert.equal(row.whole_building, false);
    assert.deepEqual(row.units, ["1A", "1B"]);
    assert.deepEqual(row.unit_ids, ["U51", "U52"], "which units the names meant");
    assert.match(documenso.calls.lastCopy.prefill.find((p) => p.id === 2).value, /500 Shared Blvd, St\. Louis, Missouri 63130\nUnits: 1A, 1B/);
  });

  it("a published building where the renter's own units are not live yet still goes on, with their units", async () => {
    const db = world();
    db.tables.listings.push(listing("L6", "600 Shared Blvd"));
    const unpub = (id, name) => ({ id, listing_id: "L6", name, published_at: null, deleted_at: null });
    db.tables.unit_leases.push(
      { id: "Q6", owner_id: "u1", published_at: null, deleted_at: null, listing_units: unpub("U61", "01") },
      { id: "Q7", owner_id: "u1", published_at: null, deleted_at: null, listing_units: unpub("U62", "02") }
    );
    const documenso = fakeDocumenso();
    await sign(db, documenso, { exhibit: [...DRAFTS_OFF, { listingId: "L6", wholeBuilding: false, units: ["01", "02"] }] });
    const entry = db.tables.landlord_agreements[0].exhibit.find((e) => e.listingId === "L6");
    assert.deepEqual(entry, { listingId: "L6", address: "600 Shared Blvd, St. Louis, Missouri 63130", wholeBuilding: false, units: ["01", "02"], unitIds: ["U61", "U62"] });
    assert.match(documenso.calls.lastCopy.prefill.find((p) => p.id === 2).value, /600 Shared Blvd, St\. Louis, Missouri 63130\nUnits: 01, 02/);
  });

  it("a covered unit renamed stays covered under its new name; a new unit given the old name is not", async () => {
    const db = renter();
    const documenso = fakeDocumenso();
    await sign(db, documenso, { exhibit: [...DRAFTS_OFF, { listingId: "L5", wholeBuilding: false, units: ["1A", "1B"] }] });
    documenso.complete("envelope_1");
    await applyEnvelope(db, documenso, await documenso.getEnvelope("envelope_1"), { storeSigned });
    db.tables.unit_leases.find((l) => l.id === "Q1").listing_units.name = "1A Garden";
    let { properties, covered } = await coverageFor(db, "u1");
    let p = properties.find((x) => x.listingId === "L5");
    assert.equal(coversProperty(p, covered.get("L5")), true, "renaming does not undo coverage");
    assert.deepEqual(covered.get("L5").units, ["1A Garden", "1B"]);
    assert.deepEqual(covered.get("L5").formerNames, ["1A"]);

    // A new unit called "1A" (the old name) with Pat's lease on it is not covered.
    db.tables.unit_leases.push(lease("Q3", u5("U53", "1A")));
    ({ properties, covered } = await coverageFor(db, "u1"));
    p = properties.find((x) => x.listingId === "L5");
    assert.equal(coversProperty(p, covered.get("L5")), false);
    assert.deepEqual(missingUnits(p, covered.get("L5")), ["1A"]);
  });

  it("the next addendum restates the renamed unit with its old name, in the before list", async () => {
    const db = renter();
    const documenso = fakeDocumenso();
    await sign(db, documenso, { exhibit: [...DRAFTS_OFF, { listingId: "L5", wholeBuilding: false, units: ["1A", "1B"] }] });
    documenso.complete("envelope_1", "2027-01-05T12:00:00.000Z");
    await applyEnvelope(db, documenso, await documenso.getEnvelope("envelope_1"), { storeSigned });
    db.tables.unit_leases.find((l) => l.id === "Q1").listing_units.name = "1A Garden";
    db.tables.unit_leases.push(lease("Q3", u5("U53", "2C")));
    const r = await sign(db, documenso, { now: new Date("2027-02-01"), exhibit: [...DRAFTS_OFF, { listingId: "L5", wholeBuilding: false, units: ["2C"] }] });
    assert.equal(r.kind, "amendment");
    const amendment = db.tables.agreement_amendments[0];
    const before = amendment.previous_exhibit.find((e) => e.listingId === "L5");
    assert.deepEqual(before.units, ["1A Garden", "1B"]);
    assert.match(coverageLine(before), /Units: 1A Garden, 1B \(formerly 1A\)/);
    assert.match(exhibitText(amendment.previous_exhibit), /Units: 1A Garden, 1B \(formerly 1A\)/, "the addendum's before list says so");
    const added = db.tables.agreement_coverage.find((c) => c.amendment_id === amendment.id);
    assert.deepEqual([...added.unit_ids].sort(), ["U51", "U52", "U53"]);
  });

  it("a lease on another unit there needs an amendment adding that unit", async () => {
    const db = renter();
    const documenso = fakeDocumenso();
    await sign(db, documenso);
    documenso.complete("envelope_1", "2027-01-05T12:00:00.000Z");
    await applyEnvelope(db, documenso, await documenso.getEnvelope("envelope_1"), { storeSigned });
    assert.equal((await coverageFor(db, "u1", new Date("2027-02-01"))).covered.has("L5"), true);
    // Pat adds a lease on 2C: L5 is no longer fully covered.
    db.tables.unit_leases.push(lease("Q3", u5("U53", "2C")));
    const { properties, covered } = await coverageFor(db, "u1", new Date("2027-02-01"));
    assert.deepEqual(uncoveredAmong(properties, covered, ["L5"]), [{ listingId: "L5", address: "500 Shared Blvd, St. Louis, Missouri 63130", missingUnits: ["2C"] }]);
    const r = await sign(db, documenso, { listingIds: ["L5"], now: new Date("2027-02-01") });
    assert.equal(r.kind, "amendment");
    const a = db.tables.agreement_amendments[0];
    assert.deepEqual(a.proposed_exhibit.find((e) => e.listingId === "L5").units, ["1A", "1B", "2C"]);
    documenso.complete("envelope_2", "2027-02-02T00:00:00.000Z");
    await applyEnvelope(db, documenso, await documenso.getEnvelope("envelope_2"), { storeSigned });
    const after = await coverageFor(db, "u1", new Date("2027-02-03"));
    assert.deepEqual(uncoveredAmong(after.properties, after.covered, ["L5"]), [], "now covered, by the agreement and the amendment together");
  });

  it("units with the landlord's leases can be deselected; they are reported as dropped (2026-11-07)", () => {
    const p = { listingId: "L", owner: true, units: ["Apt 1", "Apt 2", "Apt 3"], leaseUnits: ["Apt 2"] };
    assert.deepEqual(exhibitChoice(p, { wholeBuilding: false, units: ["Apt 1"] }, { locked: true }), { include: true, wholeBuilding: false, units: ["Apt 1"], dropped: ["Apt 2"] });
    assert.deepEqual(exhibitChoice(p, { wholeBuilding: true }).dropped, [], "the whole building drops nothing");
    // What is covered already stays covered and is the default.
    const cov = { whole_building: false, units: ["Apt 3"] };
    assert.deepEqual(exhibitChoice(p, null, { covered: cov }), { include: true, wholeBuilding: false, units: ["Apt 2", "Apt 3"], dropped: [] });
    assert.deepEqual(exhibitChoice(p, { wholeBuilding: false, units: [] }, { covered: cov }).units, ["Apt 3"], "covered units cannot be removed");
    assert.deepEqual(exhibitChoice(p, { include: false }, { locked: true }).include, true, "a locked property stays on");
    assert.deepEqual(exhibitChoice(p, { include: false }, { locked: false }).include, false, "a draft can come off");
    assert.deepEqual(exhibitChoice(p, { wholeBuilding: false, units: ["Nope"] }).units, [], "only units the property has");
    assert.deepEqual(exhibitChoice(p, null).wholeBuilding, true, "an owner's default: the whole building");
    assert.deepEqual(exhibitChoice(p, { include: false }).wholeBuilding, true, "a choice that does not say keeps the default");
  });
});

describe("paper agreements recorded by an admin", () => {
  it("cover what the landlord has live on the signing date, for a year", async () => {
    const db = world();
    await markAgreementSigned(db, { userId: "u1", signerName: "Pat", signedAt: "2026-10-10T00:00:00.000Z" });
    const row = db.tables.landlord_agreements[0];
    assert.equal(row.term_end, undefined);
    const { covered } = await coverageFor(db, "u1", new Date("2027-02-01"));
    assert.deepEqual([...covered.keys()], ["L1"]);
  });
});

describe("the publish check's message", () => {
  it("names the property to add, and stays out of the way for review sandbox accounts", () => {
    const uncovered = [{ listingId: "L3", address: "300 Draft Ave" }];
    assert.match(gateMessage(["agreement"], uncovered), /add 300 Draft Ave to your marketing agreement/);
    assert.match(gateMessage(["agreement"], [...uncovered, { listingId: "L4", address: "x" }]), /add 2 properties/);
    assert.equal(gateDecision({ role: "landlord", requireAgreement: true, agreementSigned: false, sandbox: true }).allowed, true);
    const props = [{ listingId: "L3", address: "300 Draft Ave" }];
    assert.deepEqual(uncoveredAmong(props, new Map(), ["L3", "L3"]), uncovered);
  });
});

describe("Exhibit A pages", () => {
  it("an amendment's pages show Exhibit A before and after, and run onto more pages", async () => {
    const previous = Array.from({ length: 30 }, (_, i) => ({ listingId: `L${i}`, address: `${6000 + i} Pershing Avenue`, units: [] }));
    const entries = [...previous, { listingId: "N1", address: "1 New Street", units: [] }];
    const { bytes, pageCount } = await buildExhibitPdf({ kind: "amendment", landlordName: "Pat", entries, previous, agreementSignedAt: "2026-11-05T18:00:00Z" });
    assert.ok(pageCount >= 2);
    assert.equal(String.fromCharCode(...bytes.subarray(0, 5)), "%PDF-");
  });

  it("opened, a signed document reads: the agreement, Exhibit A last, then the signing certificates", async () => {
    const page = async (n) => {
      const d = await PDFDocument.create();
      for (let i = 0; i < n; i++) d.addPage([100 + i, 100]);
      return d.save();
    };
    // Agreement: 3 pages + 1 certificate page; Exhibit A: 1 page + 1 certificate page.
    const agreement = await PDFDocument.create();
    for (const w of [11, 12, 13, 91]) agreement.addPage([w, 100]);
    const exhibit = await PDFDocument.create();
    for (const w of [21, 92]) exhibit.addPage([w, 100]);
    const merged = await PDFDocument.load(
      await mergeSignedParts([
        { bytes: await agreement.save(), bodyPages: 3 },
        { bytes: await exhibit.save(), bodyPages: 1 },
      ])
    );
    assert.deepEqual(merged.getPages().map((p) => p.getWidth()), [11, 12, 13, 21, 91, 92]);
    assert.ok(await page(1));
  });

  it("a signed document opens as one PDF: its parts joined in order", async () => {
    const one = await buildExhibitPdf({ entries: [{ listingId: "a", address: "1 A St", units: [] }] });
    const two = await buildExhibitPdf({ kind: "amendment", entries: [{ listingId: "a", address: "1 A St", units: [] }], previous: [] });
    const merged = await mergePdfs([one.bytes, two.bytes]);
    assert.equal((await PDFDocument.load(merged)).getPageCount(), one.pageCount + two.pageCount);
  });

  it("lists every property with its units, runs onto more pages, and keeps text drawable", async () => {
    const entries = Array.from({ length: 60 }, (_, i) => ({ listingId: `L${i}`, address: `${6000 + i} Pershing Avenue, St. Louis, Missouri 63112`, units: ["Apt 1", "Apt 2"] }));
    const { bytes, pageCount } = await buildExhibitPdf({ landlordName: "Café Rentals LLC", entries });
    assert.ok(pageCount >= 3);
    const doc = await PDFDocument.load(bytes);
    assert.equal(doc.getPageCount(), pageCount);
    const amendment = await buildExhibitPdf({ kind: "amendment", landlordName: "X", previous: entries.slice(0, 2), entries: entries.slice(0, 3) });
    assert.equal(amendment.pageCount, 1);
    assert.equal(pdfSafe("Café – “Loft” ✓"), 'Cafe - "Loft" ?');
  });

  it("addresses read without the country", () => {
    assert.equal(displayAddress({ address: "6105 Delmar Boulevard, St. Louis, Missouri 63112, United States" }), "6105 Delmar Boulevard, St. Louis, Missouri 63112");
  });
});

describe("commission rate", () => {
  it("shows with a percent sign", () => {
    assert.equal(formatRate(8.5), "8.5%");
    assert.equal(formatRate(null), null);
  });
});

describe("boxes filled on the landlord's copy (Wyatt 2026-11-05)", () => {
  const template = (fields) => ({
    id: "envelope_master",
    recipients: [{ id: 11, role: "SIGNER" }],
    fields: [{ id: 1, type: "SIGNATURE", recipientId: 11 }, ...(fields.some((f) => /exhibit/i.test(f.fieldMeta?.label ?? "")) ? [] : [{ id: 2, type: "TEXT", recipientId: 11, fieldMeta: { label: "Exhibit A" } }]), ...fields],
  });

  it("no commission rate box is filled: the rate is written into the agreement (2026-11-05)", async () => {
    const db = world();
    const documenso = fakeDocumenso();
    documenso.envelopes.set("envelope_master", template([{ id: 77, type: "NUMBER", recipientId: 11, fieldMeta: { label: "" } }]));
    await sign(db, documenso, { listingIds: ["L2"] });
    assert.equal(documenso.calls.lastCopy.prefill.some((p) => p.id === 77 || p.id === 43), false);
    assert.equal(db.tables.landlord_agreements[0].commission_rate_percent, 8.5, "the rate is still recorded for invoices");
  });

  it("the signer's full name goes on the copy and in a Name text box", async () => {
    const db = world();
    const documenso = fakeDocumenso();
    documenso.envelopes.set("envelope_master", template([{ id: 78, type: "TEXT", recipientId: 11, fieldMeta: { label: "Name" } }]));
    await sign(db, documenso, { listingIds: ["L2"], signerName: "  Pat   Q. Landlord " });
    assert.equal(documenso.calls.lastCopy.name, "Pat Q. Landlord");
    assert.deepEqual(documenso.calls.lastCopy.prefill.find((p) => p.id === 78), { id: 78, value: "Pat Q. Landlord" });
  });

  it("the company typed on the form fills a Company box, separate from the Name box (2026-11-06)", async () => {
    const db = world();
    const documenso = fakeDocumenso();
    documenso.envelopes.set(
      "envelope_master",
      template([
        { id: 78, type: "TEXT", recipientId: 11, fieldMeta: { label: "Name" } },
        { id: 79, type: "TEXT", recipientId: 11, fieldMeta: { label: "Company" } },
        { id: 80, type: "TEXT", recipientId: 11, fieldMeta: { label: "Owner" } },
        { id: 81, type: "TEXT", recipientId: 11, fieldMeta: { label: "Owner (signature page)" } },
      ])
    );
    await sign(db, documenso, { listingIds: ["L2"], signerName: "Pat Landlord", signerCompany: "  Pat   Rentals LLC " });
    const prefill = documenso.calls.lastCopy.prefill;
    assert.deepEqual(prefill.find((p) => p.id === 78), { id: 78, value: "Pat Landlord" });
    assert.deepEqual(prefill.find((p) => p.id === 79), { id: 79, value: "Pat Rentals LLC" });
    assert.equal(prefill.find((p) => p.id === 80)?.value, "Pat Rentals LLC", "the Owner box gets the company");
    assert.equal(prefill.find((p) => p.id === 81)?.value, "Pat Rentals LLC", "and so does a second Owner box");
    // Same company: the copy is reused. A different one: a fresh copy.
    await sign(db, documenso, { listingIds: ["L2"], signerName: "Pat Landlord", signerCompany: "Pat Rentals LLC" });
    assert.equal(documenso.calls.copies, 1);
    await sign(db, documenso, { listingIds: ["L2"], signerName: "Pat Landlord", signerCompany: "Other Co" });
    assert.equal(documenso.calls.copies, 2);
  });

  it("the copy is opened while the license question is answered, so answering only hands back the token", async () => {
    const db = world();
    const documenso = fakeDocumenso();
    assert.deepEqual(await sign(db, documenso, { listingIds: ["L2"], prepare: true }), { prepared: true, kind: "master" });
    assert.equal((await documenso.getEnvelope("envelope_1")).status, "PENDING", "already signable");
    const r = await sign(db, documenso, { listingIds: ["L2"] });
    assert.equal(r.token, "token_1");
    assert.equal(documenso.calls.copies, 1);
  });

  it("fills Email and Address 1/2 from the form, and Exhibit A into its own box with no separate document (2026-11-06)", async () => {
    const db = world();
    const documenso = fakeDocumenso();
    documenso.envelopes.set(
      "envelope_master",
      template([
        { id: 90, type: "TEXT", recipientId: 11, fieldMeta: { label: "Email" } },
        { id: 91, type: "TEXT", recipientId: 11, fieldMeta: { label: "Address 1" } },
        { id: 92, type: "TEXT", recipientId: 11, fieldMeta: { label: "Address 2" } },
        { id: 93, type: "TEXT", recipientId: 11, fieldMeta: { label: "Exhibit A" } },
      ])
    );
    await sign(db, documenso, {
      listingIds: ["L2"],
      signerEmail: "leasing@patrentals.com",
      // The street from the address search, the suite, and the city line that came with the street.
      signerAddress1: "8151 Clayton Rd",
      signerAddress2: "Suite 301",
      signerCity: "St. Louis, MO 63117",
    });
    const value = (id) => documenso.calls.lastCopy.prefill.find((p) => p.id === id)?.value;
    assert.equal(value(90), "leasing@patrentals.com");
    assert.equal(value(91), "8151 Clayton Rd, Suite 301", "street and suite on one line");
    assert.equal(value(92), "St. Louis, MO 63117", "the city line below it");
    assert.equal(value(93), "100 Live St, St. Louis, Missouri 63130\nWhole building\n\n200 Draft Ave, St. Louis, Missouri 63130\nWhole building");
    assert.equal(documenso.calls.lastCopy.exhibit, null, "no separate Exhibit A document");
    // A changed address on the form makes a fresh copy.
    await sign(db, documenso, { listingIds: ["L2"], signerEmail: "leasing@patrentals.com", signerAddress1: "1 Other St", signerAddress2: "Suite 301", signerCity: "St. Louis, MO 63117" });
    assert.equal(documenso.calls.copies, 2);
  });

  it("a list too long for the Exhibit A box continues on generated pages attached to the copy (2026-11-07)", async () => {
    const db = world();
    const documenso = fakeDocumenso();
    // A box about two lines tall: one property fits, the rest go on extra pages.
    documenso.envelopes.set("envelope_master", template([{ id: 93, type: "TEXT", recipientId: 11, page: 7, height: 4, width: 75, fieldMeta: { label: "Exhibit A" } }]));
    await sign(db, documenso, { listingIds: ["L2"], exhibit: [{ listingId: "L3", include: true }] });
    const box = documenso.calls.lastCopy.prefill.find((p) => p.id === 93).value;
    assert.match(box, /Continued on the attached Exhibit A \(continued\) pages\.$/);
    const extra = documenso.calls.lastCopy.exhibit;
    assert.ok(extra && extra.pageCount >= 1, "continued pages attached");
    assert.equal(extra.fileName, "exhibit-a-continued.pdf");
    const pdf = await PDFDocument.load(extra.bytes);
    assert.equal(pdf.getPageCount(), extra.pageCount);
    assert.equal(pdf.getTitle(), "EXHIBIT A (CONTINUED)");
  });

  it("one document per envelope: a template without an Exhibit A box is not offered for signing", async () => {
    const db = world();
    const documenso = fakeDocumenso();
    documenso.envelopes.set("envelope_master", { id: "envelope_master", recipients: [{ id: 11, role: "SIGNER" }], fields: [{ id: 1, type: "SIGNATURE", recipientId: 11 }] });
    await assert.rejects(() => sign(db, documenso, { listingIds: ["L2"] }), (e) => e.code === "not_available");
    assert.equal(exhibitText([]), "None.");
    assert.throws(() => cleanSignerDetails({ email: "not an email" }), (e) => e.code === "bad_email");
  });

  it("an addendum's Exhibit A box lists only what it adds, and [AGREEMENT DATE] is the agreement's date (2026-11-07)", async () => {
    const { db, documenso } = await (async () => {
      const db = world();
      const documenso = fakeDocumenso();
      await sign(db, documenso, { listingIds: ["L2"] });
      documenso.complete("envelope_1", "2027-01-05T12:00:00.000Z");
      await applyEnvelope(db, documenso, await documenso.getEnvelope("envelope_1"), { storeSigned });
      return { db, documenso };
    })();
    await sign(db, documenso, { listingIds: ["L3"], now: new Date("2027-02-01") });
    const text = documenso.calls.lastCopy.prefill.find((p) => p.id === 2)?.value;
    assert.equal(text, "300 Draft Ave, St. Louis, Missouri 63130\nWhole building", "only the property being added");
    assert.equal(documenso.calls.lastCopy.exhibit, null, "nothing attached");
  });

  it("needs a first and last name", async () => {
    assert.equal(cleanSignerName("Pat Landlord"), "Pat Landlord");
    assert.throws(() => cleanSignerName("Pat"), (e) => e.code === "full_name_required");
    assert.throws(() => cleanSignerName(" "), (e) => e.code === "name_required");
    await assert.rejects(() => sign(world(), fakeDocumenso(), { signerName: "Pat" }), (e) => e.code === "full_name_required");
  });

  it("a changed name makes a fresh copy instead of reusing the one in progress", async () => {
    const db = world();
    const documenso = fakeDocumenso();
    await sign(db, documenso, { listingIds: ["L2"], signerName: "Pat Landlord" });
    await sign(db, documenso, { listingIds: ["L2"], signerName: "Pat Landlord" });
    assert.equal(documenso.calls.copies, 1, "same name: reused");
    await sign(db, documenso, { listingIds: ["L2"], signerName: "Patricia Landlord" });
    assert.equal(documenso.calls.copies, 2);
    assert.equal(documenso.calls.lastCopy.name, "Patricia Landlord");
  });

  it("is not offered for signing when the template cannot be read (its Exhibit A box cannot be confirmed)", async () => {
    const db = world();
    const documenso = fakeDocumenso();
    const read = documenso.getEnvelope;
    documenso.getEnvelope = async (id) => {
      if (id === "envelope_master") throw new Error("down");
      return read(id);
    };
    await assert.rejects(() => sign(db, documenso, { listingIds: ["L2"] }), (e) => e.code === "not_available");
  });
});

describe("voiding a document from the admin dashboard", () => {
  async function signedMaster() {
    const db = world();
    const documenso = fakeDocumenso();
    await sign(db, documenso, { listingIds: ["L2"] });
    documenso.complete("envelope_1", "2027-01-05T12:00:00.000Z");
    await applyEnvelope(db, documenso, await documenso.getEnvelope("envelope_1"), { storeSigned });
    return { db, documenso, master: db.tables.landlord_agreements[0] };
  }

  it("a signed master: voided, everything it covered released, its amendment in progress cancelled", async () => {
    const { db, documenso, master } = await signedMaster();
    await sign(db, documenso, { listingIds: ["L3"], now: new Date("2027-02-01") });
    const r = await voidDocument(db, documenso, { userId: "u1", kind: "master", id: master.id });
    assert.equal(r.status, "voided");
    assert.equal(r.released, 2);
    assert.equal(db.tables.landlord_agreements[0].status, "voided");
    assert.equal(db.tables.agreement_amendments[0].status, "voided");
    assert.ok(documenso.calls.cancelled.includes("envelope_2"));
    assert.deepEqual(coverage(db).map((c) => c.status), ["released", "released", "released"]);
    const { state, covered } = await coverageFor(db, "u1", new Date("2027-02-02"));
    assert.equal(state.signed, null);
    assert.equal(covered.size, 0);
    assert.ok(db.tables.landlord_agreements[0].signed_file_key, "the signed PDF is kept");
  });

  it("a signed amendment: only the properties it added stop being covered", async () => {
    const { db, documenso } = await signedMaster();
    await sign(db, documenso, { listingIds: ["L3"], now: new Date("2027-02-01") });
    documenso.complete("envelope_2", "2027-02-02T00:00:00.000Z");
    await applyEnvelope(db, documenso, await documenso.getEnvelope("envelope_2"), { storeSigned });
    const amendment = db.tables.agreement_amendments[0];
    const r = await voidDocument(db, documenso, { userId: "u1", kind: "amendment", id: amendment.id });
    assert.equal(r.released, 1);
    const { covered } = await coverageFor(db, "u1", new Date("2027-02-03"));
    assert.deepEqual([...covered.keys()].sort(), ["L1", "L2"]);
  });

  it("a copy still being signed is cancelled in Documenso", async () => {
    const db = world();
    const documenso = fakeDocumenso();
    await sign(db, documenso, { listingIds: ["L2"] });
    const row = db.tables.landlord_agreements[0];
    await voidDocument(db, documenso, { userId: "u1", kind: "master", id: row.id });
    assert.equal(row.status, "voided");
    assert.deepEqual(documenso.calls.cancelled, ["envelope_1"]);
    assert.deepEqual(coverage(db).map((c) => c.status), ["released", "released"]);
  });

  it("refuses another landlord's document and one already ended", async () => {
    const { db, documenso, master } = await signedMaster();
    await assert.rejects(() => voidDocument(db, documenso, { userId: "someone-else", kind: "master", id: master.id }), (e) => e.code === "not_found");
    await voidDocument(db, documenso, { userId: "u1", kind: "master", id: master.id });
    await assert.rejects(() => voidDocument(db, documenso, { userId: "u1", kind: "master", id: master.id }), (e) => e.code === "already_ended");
  });

  it("the older Void by email also releases what a signed agreement covered", async () => {
    const { db, documenso } = await signedMaster();
    await voidAgreement(db, documenso, { userId: "u1" });
    assert.deepEqual(coverage(db).map((c) => c.status), ["released", "released"]);
  });
});

describe("leaving a live property off Exhibit A (2026-11-07)", () => {
  // Pat owns L1 (live, an offering on Apt 1) and rents Apt 9 in L5, someone else's
  // live building where Sam also lists Apt 8.
  function liveWorld() {
    const db = world();
    db.tables.listings.push(listing("L5", "500 Shared Blvd"));
    const lease = (id, owner, u) => ({ id, owner_id: owner, unit_id: u.id, published_at: "2026-10-01T00:00:00Z", deleted_at: null, is_active: true, unavailable: false, listing_units: u });
    const u9 = unit("U9", "L5", "Apt 9");
    const u8 = unit("U8", "L5", "Apt 8");
    db.tables.listing_units.push({ ...u9, deleted_at: null }, { ...u8, deleted_at: null });
    db.tables.unit_leases.push(lease("Q1", "u1", unit("U1", "L1", "Apt 1")), lease("Q9", "u1", u9), lease("Q8", "u2", u8));
    return db;
  }
  const leaseOf = (db, id) => db.tables.unit_leases.find((l) => l.id === id);

  it("leaves it off the document but keeps it live until the document is signed", async () => {
    const db = liveWorld();
    const documenso = fakeDocumenso();
    await sign(db, documenso, { exhibit: [...DRAFTS_OFF, { listingId: "L1", include: false, excluded: true }, { listingId: "L5", include: false, excluded: true }] });
    const doc = db.tables.landlord_agreements[0];
    assert.deepEqual(ids(doc.exhibit), []);
    assert.deepEqual([...doc.withdraw_on_sign].sort(), ["L1", "L5"]);
    assert.equal(leaseOf(db, "Q1").is_active, true, "an unsigned (or abandoned) popup changes nothing");
    documenso.complete("envelope_1");
    assert.equal(await applyEnvelope(db, documenso, await documenso.getEnvelope("envelope_1"), { storeSigned }), "signed");
    assert.equal(leaseOf(db, "Q1").is_active, false);
    assert.equal(leaseOf(db, "Q1").unavailable, true);
    assert.equal(leaseOf(db, "Q9").is_active, false);
    assert.equal(leaseOf(db, "Q8").is_active, true, "another landlord's offering in the same building stays live");
  });

  it("excluding a draft property keeps its draft offerings as drafts, and only live ones come off", async () => {
    const db = liveWorld();
    // L2 is Pat's draft property: a draft offering on its Studio.
    db.tables.unit_leases.push({ id: "QD", owner_id: "u1", unit_id: "U3", published_at: null, deleted_at: null, is_active: true, unavailable: false, listing_units: unit("U3", "L2", "Studio", false) });
    const documenso = fakeDocumenso();
    await sign(db, documenso, { exhibit: [{ listingId: "L2", include: false, excluded: true }, { listingId: "L3", include: false }, { listingId: "L4", include: false }] });
    documenso.complete("envelope_1");
    assert.equal(await applyEnvelope(db, documenso, await documenso.getEnvelope("envelope_1"), { storeSigned }), "signed");
    assert.equal(leaseOf(db, "QD").is_active, true, "still a draft: publishing L2 later puts it live");
    assert.equal(leaseOf(db, "QD").unavailable, false);
  });

  it("a live property the popup does not exclude stays on the document", async () => {
    const db = liveWorld();
    const documenso = fakeDocumenso();
    await sign(db, documenso, { exhibit: [...DRAFTS_OFF, { listingId: "L1", include: false }] });
    assert.deepEqual(ids(db.tables.landlord_agreements[0].exhibit).sort(), ["L1", "L5"]);
    assert.deepEqual(db.tables.landlord_agreements[0].withdraw_on_sign, []);
  });

  it("never withdraws a property being published", async () => {
    const db = liveWorld();
    const documenso = fakeDocumenso();
    await sign(db, documenso, { listingIds: ["L1"], exhibit: [...DRAFTS_OFF, { listingId: "L1", include: false, excluded: true }] });
    assert.ok(ids(db.tables.landlord_agreements[0].exhibit).includes("L1"));
    assert.deepEqual(db.tables.landlord_agreements[0].withdraw_on_sign, []);
  });
});

describe("deselected units and addenda that only add (Wyatt, 2026-11-07)", () => {
  // Pat owns L1 (live): Apt 1 and Apt 2 each hold one of Pat's offerings.
  function twoUnits() {
    const db = world();
    const lease = (id, u) => ({ id, owner_id: "u1", unit_id: u.id, published_at: "2026-10-01T00:00:00Z", deleted_at: null, is_active: true, unavailable: false, listing_units: u });
    db.tables.unit_leases.push(lease("Q1", unit("U1", "L1", "Apt 1")), lease("Q2", unit("U2", "L1", "Apt 2")));
    return db;
  }
  const leaseOf = (db, id) => db.tables.unit_leases.find((l) => l.id === id);

  it("a deselected unit's leases come off the site once the agreement is signed, not before", async () => {
    const db = twoUnits();
    const documenso = fakeDocumenso();
    await sign(db, documenso, { exhibit: [...DRAFTS_OFF, { listingId: "L1", wholeBuilding: false, units: ["Apt 1"] }] });
    const master = db.tables.landlord_agreements[0];
    assert.deepEqual(master.exhibit.find((e) => e.listingId === "L1").units, ["Apt 1"], "the document lists only what was picked");
    assert.deepEqual(master.withdraw_unit_ids_on_sign, ["U2"]);
    assert.equal(leaseOf(db, "Q2").is_active, true, "nothing changes before signing");
    documenso.complete("envelope_1", "2027-01-05T12:00:00.000Z");
    await applyEnvelope(db, documenso, await documenso.getEnvelope("envelope_1"), { storeSigned });
    assert.equal(leaseOf(db, "Q2").is_active, false);
    assert.equal(leaseOf(db, "Q1").is_active, true);
    // With Apt 2 withdrawn, L1 is fully covered...
    const { properties, covered } = await coverageFor(db, "u1", new Date("2027-02-01"));
    assert.deepEqual(uncoveredAmong(properties, covered, ["L1"]), []);
    // ...but putting Apt 2's lease back on the market needs it covered first.
    assert.deepEqual(uncoveredAmong(properties, covered, ["L1"], { extraUnits: new Map([["L1", ["Apt 2"]]]) })[0].missingUnits, ["Apt 2"]);
  });

  it("putting a withdrawn unit back opens an addendum for that unit, not a loop", async () => {
    const db = twoUnits();
    const documenso = fakeDocumenso();
    await sign(db, documenso, { exhibit: [...DRAFTS_OFF, { listingId: "L1", wholeBuilding: false, units: ["Apt 1"] }] });
    documenso.complete("envelope_1", "2027-01-05T12:00:00.000Z");
    await applyEnvelope(db, documenso, await documenso.getEnvelope("envelope_1"), { storeSigned });
    assert.equal(leaseOf(db, "Q2").is_active, false);
    // Without the unit, there is nothing to sign: that was the loop.
    const plain = await sign(db, documenso, { listingIds: ["L1"], now: new Date("2027-02-01") });
    assert.equal(plain.alreadySigned, true);
    // The publish check names Apt 2; the popup passes it on.
    const r = await sign(db, documenso, { listingIds: ["L1"], requiredUnits: new Map([["L1", ["Apt 2"]]]), now: new Date("2027-02-01") });
    assert.equal(r.kind, "amendment");
    assert.deepEqual(db.tables.agreement_amendments[0].proposed_exhibit.find((e) => e.listingId === "L1").units, ["Apt 1", "Apt 2"]);
  });

  it("a rebuilt copy keeps the units picked (a carried property does not force its leased units back in)", async () => {
    const db = twoUnits();
    const documenso = fakeDocumenso();
    const exhibit = [...DRAFTS_OFF, { listingId: "L1", wholeBuilding: false, units: ["Apt 1"] }];
    await sign(db, documenso, { exhibit });
    await sign(db, documenso, { exhibit, signerTitle: "Manager" });
    const latest = db.tables.landlord_agreements.at(-1);
    assert.deepEqual(latest.exhibit.find((e) => e.listingId === "L1").units, ["Apt 1"]);
  });

  it("an addendum never changes a property already on the agreement unless asked", async () => {
    const db = twoUnits();
    const documenso = fakeDocumenso();
    // L2 (a draft Pat owns) goes on as units only; L1 as both units.
    db.tables.listing_units.push({ id: "U3", listing_id: "L2", name: "Studio B", published_at: null, deleted_at: null });
    await sign(db, documenso, { exhibit: [{ listingId: "L1", wholeBuilding: false, units: ["Apt 1", "Apt 2"] }, { listingId: "L2", wholeBuilding: false, units: ["Studio"] }, { listingId: "L3", include: false }, { listingId: "L4", include: false }] });
    documenso.complete("envelope_1", "2027-01-05T12:00:00.000Z");
    await applyEnvelope(db, documenso, await documenso.getEnvelope("envelope_1"), { storeSigned });
    // Publishing L3 later, with no word about L2: L2 stays units only.
    const r = await sign(db, documenso, { listingIds: ["L3"], now: new Date("2027-02-01"), exhibit: [{ listingId: "L4", include: false }] });
    assert.equal(r.kind, "amendment");
    const a = db.tables.agreement_amendments[0];
    assert.deepEqual(ids(a.proposed_exhibit.filter((e) => a.previous_exhibit.every((p) => p.listingId !== e.listingId || JSON.stringify(p) !== JSON.stringify(e)))), ["L3"], "only L3 is added");
    assert.equal(a.proposed_exhibit.find((e) => e.listingId === "L2").wholeBuilding, false);
  });

  it("deselecting the only missing units needs no addendum: their leases come off at once", async () => {
    const db = twoUnits();
    const documenso = fakeDocumenso();
    await sign(db, documenso, { exhibit: [...DRAFTS_OFF, { listingId: "L1", wholeBuilding: false, units: ["Apt 1", "Apt 2"] }] });
    documenso.complete("envelope_1", "2027-01-05T12:00:00.000Z");
    await applyEnvelope(db, documenso, await documenso.getEnvelope("envelope_1"), { storeSigned });
    db.tables.listing_units.push({ id: "U9", listing_id: "L1", name: "Apt 9", published_at: "2026-10-01T00:00:00Z", deleted_at: null });
    db.tables.unit_leases.push({ id: "Q9", owner_id: "u1", unit_id: "U9", published_at: null, deleted_at: null, is_active: true, unavailable: false, listing_units: { id: "U9", listing_id: "L1", name: "Apt 9", published_at: "2026-10-01T00:00:00Z" } });
    const r = await sign(db, documenso, { now: new Date("2027-02-01"), exhibit: [...DRAFTS_OFF, { listingId: "L1", wholeBuilding: false, units: ["Apt 1", "Apt 2"] }] });
    assert.equal(r.alreadySigned, true);
    assert.equal(db.tables.agreement_amendments.length, 0);
    assert.equal(leaseOf(db, "Q9").is_active, false);
  });
});
