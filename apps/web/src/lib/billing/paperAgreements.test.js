/*
 * Run with: npm test (from apps/web).
 *
 * A marketing agreement signed on paper (Wyatt, 2026-11-17): printed with the
 * chosen properties held, recorded with the confirmed list, or voided.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { fakeDb, fakeDocumenso } from "./billingFakes.testutil.js";
import { agreementState, coverageFor, startSigning, voidDocument } from "./agreements.js";
import { exhibitPreview } from "./exhibitUnits.js";
import { checkListingGate, gateResponseBody } from "./listingGate.js";
import { paperPreview, printPaperAgreement, publishCovered, recordPaperAgreement, recordPreview } from "./paperAgreements.js";
import { buildPaperAgreementPdf, signatureAndDateLines } from "./paperAgreementPdf.js";

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
  file_key: "billing/versions/vm.pdf",
};
const listing = (id, address, published = true) => ({ id, address: `${address}, St. Louis, Missouri 63130, United States`, published_at: published ? "2026-10-01T00:00:00Z" : null });
const unit = (id, listingId, name, published = true) => ({ id, listing_id: listingId, name, published_at: published ? "2026-10-01T00:00:00Z" : null });

// Pat owns 100 Live St (live) and two drafts, 200 Draft Ave and 300 Draft Ave.
function world() {
  return fakeDb({
    agreement_versions: [{ ...MASTER }],
    users: [{ id: "u1", name: "Pat Landlord", email: "pat@example.com", roles: { name: "landlord" } }],
    billing_settings: [{ key: "agreement_required", value: true }],
    listing_landlords: [
      { user_id: "u1", listing_id: "L1" },
      { user_id: "u1", listing_id: "L2" },
      { user_id: "u1", listing_id: "L3" },
    ],
    listings: [listing("L1", "100 Live St"), listing("L2", "200 Draft Ave", false), listing("L3", "300 Draft Ave", false)],
    listing_units: [unit("U1", "L1", "Apt 1"), unit("U3", "L2", "Studio", false), unit("U4", "L3", "Loft", false)],
    unit_leases: [],
  });
}
const now = new Date("2027-01-10T18:00:00Z");
const L3_OFF = [{ listingId: "L3", include: false, excluded: true }];
const statuses = (db, agreementId) =>
  Object.fromEntries(db.tables.agreement_coverage.filter((c) => c.agreement_id === agreementId && c.status !== "released").map((c) => [c.listing_id, c.status]));

describe("paper agreements", () => {
  it("the admin's picker is the landlord's, with the company to print", async () => {
    const preview = await paperPreview(world(), "u1", now);
    assert.deepEqual(preview.properties.map((p) => p.listingId).sort(), ["L1", "L2", "L3"]);
    assert.equal(preview.versionLabel, "Agreement 2027");
  });

  it("printing holds the chosen properties: proposed, never covered, and drafts can't publish", async () => {
    const db = world();
    const { id } = await printPaperAgreement(db, { landlordId: "u1", exhibit: L3_OFF, company: "Pat Rentals LLC", now });
    const row = db.tables.landlord_agreements.find((a) => a.id === id);
    assert.equal(row.status, "sent");
    assert.equal(row.provider, "paper");
    assert.equal(row.signer_details.company, "Pat Rentals LLC");
    assert.deepEqual(statuses(db, id), { L1: "proposed", L2: "proposed" });

    const gate = await checkListingGate(db, "u1", { listingIds: ["L2"], now });
    assert.equal(gate.allowed, false);
    assert.deepEqual(gate.missing, ["paper_agreement"], "says the paper copy is out, so no signing popup opens");
    assert.match(gateResponseBody(gate).error, /sign on paper/);
  });

  it("while a paper copy is out nobody starts another, in the app or on paper", async () => {
    const db = world();
    await printPaperAgreement(db, { landlordId: "u1", exhibit: L3_OFF, now });
    const user = { id: "u1", name: "Pat Landlord", email: "pat@example.com" };
    await assert.rejects(() => startSigning(db, fakeDocumenso(), { user, signerTitle: "Owner", authorized: true, now }), (e) => e.code === "paper_out");
    await assert.rejects(() => exhibitPreview(db, "u1", { now }), (e) => e.code === "paper_out");
    await assert.rejects(() => printPaperAgreement(db, { landlordId: "u1", exhibit: [], now }), (e) => e.code === "cannot_print" && /Void it first/.test(e.message));
  });

  it("recording the signed copy covers the confirmed list, with the paper edits", async () => {
    const db = world();
    const { id } = await printPaperAgreement(db, { landlordId: "u1", exhibit: L3_OFF, now });
    const confirm = await recordPreview(db, "u1", id, now);
    assert.deepEqual(confirm.properties.filter((p) => p.onPrinted).map((p) => p.listingId).sort(), ["L1", "L2"]);
    assert.equal(confirm.properties.find((p) => p.listingId === "L3").choice.include, false);

    // On paper they crossed off 200 Draft Ave and wrote in 300 Draft Ave.
    const r = await recordPaperAgreement(db, {
      landlordId: "u1",
      id,
      exhibit: [{ listingId: "L2", include: false, excluded: true }, { listingId: "L3", include: true }],
      signerName: "Pat Landlord",
      signedAt: new Date("2027-01-12T12:00:00Z"),
      signedFileKey: "billing/signed/u1/x.pdf",
      now: new Date("2027-01-13T12:00:00Z"),
    });
    assert.deepEqual(r.covered.sort(), ["L1", "L3"]);
    assert.deepEqual(statuses(db, id), { L1: "covered", L3: "covered" });
    const state = await agreementState(db, "u1", now);
    assert.equal(state.valid, true);
    assert.equal(state.signed.signed_file_key, "billing/signed/u1/x.pdf");
    const { covered } = await coverageFor(db, "u1", now);
    assert.deepEqual([...covered.keys()].sort(), ["L1", "L3"]);
  });

  it("the signed copy is required", async () => {
    const db = world();
    const { id } = await printPaperAgreement(db, { landlordId: "u1", exhibit: L3_OFF, now });
    await assert.rejects(() => recordPaperAgreement(db, { landlordId: "u1", id, exhibit: [], signerName: "Pat", signedFileKey: null, now }), (e) => e.code === "file_required");
  });

  it("the signed copy is stored only once the record's checks pass", async () => {
    const db = world();
    const { id } = await printPaperAgreement(db, { landlordId: "u1", exhibit: L3_OFF, now });
    let stored = 0;
    const storeSigned = async () => {
      stored += 1;
      return "billing/signed/u1/late.pdf";
    };
    const everythingOff = ["L1", "L2", "L3"].map((listingId) => ({ listingId, include: false, excluded: true }));
    await assert.rejects(() => recordPaperAgreement(db, { landlordId: "u1", id, exhibit: everythingOff, signerName: "Pat", storeSigned, now }), (e) => e.code === "no_properties");
    await assert.rejects(
      () => recordPaperAgreement(db, { landlordId: "u1", id, exhibit: L3_OFF, signerName: "Pat", storeSigned, signedAt: new Date("2027-01-20T12:00:00Z"), now }),
      (e) => e.code === "bad_date"
    );
    assert.equal(stored, 0);
    await recordPaperAgreement(db, { landlordId: "u1", id, exhibit: L3_OFF, signerName: "Pat", storeSigned, signedAt: now, now });
    assert.equal(stored, 1);
    assert.equal((await agreementState(db, "u1", now)).signed.signed_file_key, "billing/signed/u1/late.pdf");
    // Saved twice (a double click): the second is refused before anything is stored.
    await assert.rejects(() => recordPaperAgreement(db, { landlordId: "u1", id, exhibit: L3_OFF, signerName: "Pat", storeSigned, signedAt: now, now }), (e) => e.code === "not_out");
    assert.equal(stored, 1);
  });

  it("a publish that fails with a database error is reported in plain words", async () => {
    const db = world();
    const { id } = await printPaperAgreement(db, { landlordId: "u1", exhibit: L3_OFF, now });
    await recordPaperAgreement(db, { landlordId: "u1", id, exhibit: L3_OFF, signerName: "Pat", signedFileKey: "k", signedAt: now, now });
    const raw = async () => {
      throw new Error('duplicate key value violates unique constraint "listings_pkey"');
    };
    const [out] = await publishCovered(db, { landlordId: "u1", agreementId: id, listingIds: ["L2"], publishProperty: raw });
    assert.equal(out.error, "Could not publish it.");
    const readable = async () => {
      throw Object.assign(new Error("That property no longer exists."), { status: 404 });
    };
    const [said] = await publishCovered(db, { landlordId: "u1", agreementId: id, listingIds: ["L2"], publishProperty: readable });
    assert.equal(said.error, "That property no longer exists.");
  });

  it("only drafts now covered by it are published, as the landlord", async () => {
    const db = world();
    const { id } = await printPaperAgreement(db, { landlordId: "u1", exhibit: L3_OFF, now });
    await recordPaperAgreement(db, { landlordId: "u1", id, exhibit: L3_OFF, signerName: "Pat", signedFileKey: "k", signedAt: now, now });
    const calls = [];
    const out = await publishCovered(db, { landlordId: "u1", agreementId: id, listingIds: ["L2", "L3"], publishProperty: async (...a) => calls.push(a) });
    assert.deepEqual(calls, [["u1", false, "L2"]]);
    assert.deepEqual(out.map((x) => [x.listingId, x.ok]), [["L2", true], ["L3", false]]);
  });

  it("voiding the paper copy releases the hold, and a landlord who signed is pointed at the addendum", async () => {
    const db = world();
    const { id } = await printPaperAgreement(db, { landlordId: "u1", exhibit: L3_OFF, now });
    await voidDocument(db, null, { userId: "u1", kind: "master", id, now });
    assert.deepEqual(statuses(db, id), {});
    const again = await printPaperAgreement(db, { landlordId: "u1", exhibit: L3_OFF, now });
    await recordPaperAgreement(db, { landlordId: "u1", id: again.id, exhibit: L3_OFF, signerName: "Pat", signedFileKey: "k", signedAt: now, now });
    await assert.rejects(() => paperPreview(db, "u1", now), (e) => e.code === "cannot_print" && /addendum/.test(e.message));
  });

  it("an account with an authorized signer: the paper agreement is the signer's, covering the account", async () => {
    const db = world();
    db.tables.users.push({ id: "p1", name: "Ryan Signer", email: "ryan@example.com", billing_only: true });
    db.tables.billing_payers = [{ id: "bp1", landlord_id: "u1", payer_id: "p1", signer_name: "Ryan Signer", status: "active", listing_id: null }];
    const preview = await paperPreview(db, "u1", now);
    assert.equal(preview.signer.name, "Ryan Signer");

    const { id } = await printPaperAgreement(db, { landlordId: "u1", exhibit: L3_OFF, now });
    const row = db.tables.landlord_agreements.find((a) => a.id === id);
    assert.equal(row.user_id, "p1", "the record is the signer's");
    assert.deepEqual(db.tables.agreement_coverage.filter((c) => c.agreement_id === id).map((c) => c.user_id), ["u1", "u1"], "the coverage is the account's");

    const gate = await checkListingGate(db, "u1", { listingIds: ["L2"], now });
    assert.deepEqual(gate.missing, ["paper_agreement"]);
    assert.match(gateResponseBody(gate).error, /sign on paper/, "not sent to the signer to approve");

    const r = await recordPaperAgreement(db, { landlordId: "u1", id, exhibit: L3_OFF, signerName: "Ryan Signer", signedFileKey: "k", signedAt: now, now });
    assert.equal(r.holderId, "p1");
    const { covered, state } = await coverageFor(db, "u1", now);
    assert.equal(state.holderId, "p1");
    assert.deepEqual([...covered.keys()].sort(), ["L1", "L2"]);
  });
});

// A one-page agreement with [Company], [Exhibit A] and [Signature] typed in it.
async function templatePdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  page.drawText("Landlord: [Company]", { x: 60, y: 720, size: 11, font });
  page.drawText("EXHIBIT A", { x: 60, y: 600, size: 12, font });
  page.drawText("[Exhibit A]", { x: 60, y: 580, size: 11, font });
  page.drawText("Signature: [Signature]", { x: 60, y: 120, size: 11, font });
  return doc.save();
}

describe("the printed paper agreement", () => {
  it("fills Exhibit A in the agreement's own box when it fits", async () => {
    const blocks = ["100 Live St\nWhole building", "200 Draft Ave\nWhole building"];
    const { pageCount } = await buildPaperAgreementPdf({ versionBytes: await templatePdf(), blocks, company: "Pat Rentals LLC" });
    assert.equal(pageCount, 1);
  });

  it("puts what does not fit on Exhibit A (continued) pages", async () => {
    const blocks = Array.from({ length: 60 }, (_, i) => `${i + 1} Long Street, St. Louis, Missouri 63130\nWhole building`);
    const { pageCount } = await buildPaperAgreementPdf({ versionBytes: await templatePdf(), blocks });
    assert.ok(pageCount > 1);
  });

  it("draws a line only for a signature or date, and not where the agreement already has one", () => {
    const at = (type) => ({ type, area: { x: 384, w: 160, top: 552, bottom: 528, h: 24 } });
    const ownLine = [{ x0: 378, x1: 554, y: 522.5 }];
    assert.equal(signatureAndDateLines(at("SIGNATURE"), []), true);
    assert.equal(signatureAndDateLines(at("SIGNATURE"), ownLine), false, "the template's own signature line is enough");
    assert.equal(signatureAndDateLines(at("DATE"), [{ x0: 70, x1: 200, y: 522.5 }]), true, "a line in another column doesn't count");
    assert.equal(signatureAndDateLines(at("TEXT"), []), false, "name, title, email and address stay blank space");
  });

  it("prints Exhibit A on its own pages when the agreement has no box for it", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    const { pageCount } = await buildPaperAgreementPdf({ versionBytes: await doc.save(), blocks: ["100 Live St\nWhole building"] });
    assert.equal(pageCount, 2);
  });
});
