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
import { applyEnvelope, coverageFor, markAgreementSigned, startSigning, summarizeAgreementRows, termEndFor } from "./agreements.js";
import { coveredMap, displayAddress, planCoverage, uncoveredAmong } from "./coverage.js";
import { buildExhibitPdf, pdfSafe } from "./exhibitPdf.js";
import { cleanCommissionRate, formatRate, getLiveVersion, publishVersion } from "./agreementVersions.js";
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
const sign = (db, documenso, over = {}) => startSigning(db, documenso, { user, signerTitle: "Owner", authorized: true, ...over });
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
    assert.deepEqual(row.exhibit[0].units, ["Apt 1", "Apt 2"]);
    assert.equal(row.exhibit[0].address, "100 Live St, St. Louis, Missouri 63130");
    assert.equal(row.commission_rate_percent, 8.5);
    // The copy: Exhibit A attached, initials on its pages, rate and title filled in.
    const copy = documenso.calls.lastCopy;
    assert.ok(copy.exhibit.bytes.length > 500);
    assert.equal(copy.exhibit.pageCount, 1);
    assert.ok(copy.exhibit.initialsBox.width > 0);
    assert.deepEqual(copy.prefill.find((p) => p.id === 43), { id: 43, value: "8.5%" });
    assert.equal(copy.signerTitle, "Owner");
    // Proposed, not covered, until signed.
    assert.deepEqual(coverage(db).map((c) => c.status), ["proposed", "proposed", "proposed"]);
    const { covered } = await coverageFor(db, "u1");
    assert.equal(covered.size, 0, "an unsigned master covers nothing");
  });

  it("signing it covers every property on Exhibit A, for a year", async () => {
    const db = world();
    const documenso = fakeDocumenso();
    await sign(db, documenso, { listingIds: ["L2"] });
    documenso.complete("envelope_1", "2027-01-05T12:00:00.000Z");
    assert.equal(await applyEnvelope(db, documenso, await documenso.getEnvelope("envelope_1"), { storeSigned }), "signed");
    const row = db.tables.landlord_agreements[0];
    assert.equal(row.term_start, "2027-01-05T12:00:00.000Z");
    assert.equal(row.term_end, "2028-01-05T12:00:00.000Z");
    assert.ok(row.signed_exhibit_file_key, "the signed Exhibit A is stored");
    const { covered } = await coverageFor(db, "u1", new Date("2027-02-01"));
    assert.deepEqual([...covered.keys()].sort(), ["L1", "L2"]);
    // The term ends: nothing counts as covered any more.
    const later = await coverageFor(db, "u1", new Date("2028-01-06"));
    assert.equal(later.state.expired, true);
    assert.equal(later.covered.size, 0);
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

  it("publishing a new property later: a short amendment from the previous list to the new one", async () => {
    const { db, documenso } = await signedMaster();
    const r = await sign(db, documenso, { listingIds: ["L3"], now: new Date("2027-02-01") });
    assert.equal(r.kind, "amendment");
    const a = db.tables.agreement_amendments[0];
    assert.deepEqual(ids(a.previous_exhibit), ["L1", "L2"]);
    assert.deepEqual(ids(a.proposed_exhibit), ["L1", "L2", "L3"]);
    assert.equal(documenso.calls.lastCopy.templateId, "envelope_amend");
    assert.ok(documenso.calls.lastCopy.exhibit, "the amendment pages are attached for initials");
    // L3 is only proposed until the amendment is signed.
    const before = await coverageFor(db, "u1", new Date("2027-02-01"));
    assert.equal(before.covered.has("L3"), false);
    documenso.complete("envelope_2", "2027-02-02T00:00:00.000Z");
    assert.equal(await applyEnvelope(db, documenso, await documenso.getEnvelope("envelope_2"), { storeSigned }), "signed");
    const after = await coverageFor(db, "u1", new Date("2027-02-03"));
    assert.deepEqual([...after.covered.keys()].sort(), ["L1", "L2", "L3"]);
    // The master is untouched: one signature, same term.
    assert.equal(db.tables.landlord_agreements.filter((m) => m.status === "signed").length, 1);
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
    assert.deepEqual(documenso.calls.lastCopy.prefill.find((p) => p.id === 43), { id: 43, value: "6%" });
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

describe("paper agreements recorded by an admin", () => {
  it("cover what the landlord has live on the signing date, for a year", async () => {
    const db = world();
    await markAgreementSigned(db, { userId: "u1", signerName: "Pat", signedAt: "2026-10-10T00:00:00.000Z" });
    const row = db.tables.landlord_agreements[0];
    assert.equal(row.term_end, termEndFor("2026-10-10T00:00:00.000Z"));
    const { covered } = await coverageFor(db, "u1", new Date("2027-02-01"));
    assert.deepEqual([...covered.keys()], ["L1"]);
  });
});

describe("the publish check's message", () => {
  it("names the property to add, and stays out of the way for review sandbox accounts", () => {
    const uncovered = [{ listingId: "L3", address: "300 Draft Ave" }];
    assert.match(gateMessage(["agreement"], uncovered), /add 300 Draft Ave to your commission agreement/);
    assert.match(gateMessage(["agreement"], [...uncovered, { listingId: "L4", address: "x" }]), /add 2 properties/);
    assert.equal(gateDecision({ role: "landlord", requireAgreement: true, agreementSigned: false, sandbox: true }).allowed, true);
    const props = [{ listingId: "L3", address: "300 Draft Ave" }];
    assert.deepEqual(uncoveredAmong(props, new Map(), ["L3", "L3"]), uncovered);
  });
});

describe("Exhibit A pages", () => {
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
  it("is a percentage above 0 and at most 100, shown with a percent sign", () => {
    assert.equal(cleanCommissionRate("8.5%"), 8.5);
    assert.equal(cleanCommissionRate(" 10 "), 10);
    assert.throws(() => cleanCommissionRate(""), (e) => e.code === "rate_required");
    assert.throws(() => cleanCommissionRate("0"), (e) => e.code === "bad_rate");
    assert.throws(() => cleanCommissionRate("120"), (e) => e.code === "bad_rate");
    assert.equal(formatRate(8.5), "8.5%");
    assert.equal(formatRate(null), null);
  });
});
