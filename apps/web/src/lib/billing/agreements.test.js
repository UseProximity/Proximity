/*
 * Run with: npm test (from apps/web).
 *
 * The rules that need neither a database nor a bucket. The gate and agreement
 * records against the real database are exercised separately in the dev
 * environment.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { agreementView, cleanSignerTitle, markAgreementSigned, summarizeAgreementRows } from "./agreements.js";
import { signatureStillValid } from "./agreementVersions.js";
import { gateDecision, gateMessage, gateResponseBody } from "./listingGate.js";
import { MAX_SIGNED_PDF_BYTES, signedAgreementKey, validateSignedPdf } from "./agreementPdf.js";

const ON = { requirePaymentMethod: true, requireAgreement: true };

describe("gate: overdue invoice (PR #370 review)", () => {
  const OFF = { requirePaymentMethod: false, requireAgreement: false, hasPaymentMethod: false, agreementSigned: false };

  it("blocks a landlord with an overdue invoice even with both switches off", () => {
    const d = gateDecision({ role: "landlord", ...OFF, overdueInvoice: true });
    assert.equal(d.allowed, false);
    assert.deepEqual(d.missing, ["overdue_invoice"]);
    assert.match(gateMessage(d.missing), /pay your overdue invoice/);
  });

  it("never blocks admins or students for it", () => {
    assert.equal(gateDecision({ role: "admin", ...OFF, overdueInvoice: true }).allowed, true);
  });

  it("names every reason at once", () => {
    const d = gateDecision({ role: "landlord", requirePaymentMethod: true, requireAgreement: false, hasPaymentMethod: false, agreementSigned: true, overdueInvoice: true });
    assert.equal(gateMessage(d.missing), "Before you can publish a listing you need to pay your overdue invoice and add an active payment method. You can do this under Billing in your landlord dashboard. Your drafts are saved.");
  });
});

describe("gateDecision", () => {
  it("lets everyone through while both requirements are off", () => {
    const d = gateDecision({ role: "landlord", requirePaymentMethod: false, requireAgreement: false, hasPaymentMethod: false, agreementSigned: false });
    assert.deepEqual(d, { applies: true, allowed: true, missing: [] });
  });

  it("names what a landlord is missing when requirements are on", () => {
    assert.deepEqual(gateDecision({ role: "landlord", ...ON, hasPaymentMethod: false, agreementSigned: false }).missing, ["payment_method", "agreement"]);
    assert.deepEqual(gateDecision({ role: "landlord", ...ON, hasPaymentMethod: true, agreementSigned: false }).missing, ["agreement"]);
    assert.deepEqual(gateDecision({ role: "landlord", ...ON, hasPaymentMethod: false, agreementSigned: true }).missing, ["payment_method"]);
  });

  it("allows a landlord who has everything", () => {
    assert.deepEqual(gateDecision({ role: "landlord", ...ON, hasPaymentMethod: true, agreementSigned: true }), { applies: true, allowed: true, missing: [] });
  });

  it("only checks one requirement when only that one is on", () => {
    const d = gateDecision({ role: "landlord", requirePaymentMethod: false, requireAgreement: true, hasPaymentMethod: false, agreementSigned: false });
    assert.deepEqual(d.missing, ["agreement"]);
  });

  it("never applies to students, admins or anyone who is not a landlord", () => {
    for (const role of ["student", "admin", "super", "parent", "other", null, undefined]) {
      const d = gateDecision({ role, ...ON, hasPaymentMethod: false, agreementSigned: false });
      assert.deepEqual(d, { applies: false, allowed: true, missing: [] }, String(role));
    }
  });
});

describe("gate messages", () => {
  it("say what to do, in plain words, and that drafts are safe", () => {
    assert.match(gateMessage(["payment_method"]), /add an active payment method/);
    assert.match(gateMessage(["agreement"]), /sign the marketing agreement/);
    const both = gateMessage(["payment_method", "agreement"]);
    assert.match(both, /add an active payment method and sign the marketing agreement/);
    assert.match(both, /Billing/);
    assert.match(both, /drafts are saved/i);
  });

  it("never use an em dash (repo rule)", () => {
    const dash = String.fromCharCode(0x2014);
    for (const m of [["payment_method"], ["agreement"], ["payment_method", "agreement"]]) {
      assert.ok(!gateMessage(m).includes(dash));
    }
  });

  it("come back with a code the app can recognise", () => {
    const body = gateResponseBody({ missing: ["agreement"] });
    assert.equal(body.code, "billing_setup_required");
    assert.deepEqual(body.missing, ["agreement"]);
    assert.ok(body.error.length > 0);
  });
});

describe("agreementView", () => {
  const live = { id: "v2", label: "December 2026", provider_template_id: "envelope_t", provider_recipient_id: 7 };
  const signedRow = (over) => ({
    id: "a1",
    status: "signed",
    version: "November 2026",
    signed_at: "2026-11-02T12:00:00Z",
    signer_name: "Pat",
    signer_title: "Owner",
    signed_file_key: "billing/agreements/u/f.pdf",
    agreement_version: { id: "v1", label: "November 2026", published_at: "2026-11-01T00:00:00Z" },
    ...over,
  });

  it("reads as not signed, and signable once a version is live", () => {
    assert.equal(agreementView(summarizeAgreementRows([])).status, "not_signed");
    assert.equal(agreementView(summarizeAgreementRows([])).canSign, false);
    assert.equal(agreementView(summarizeAgreementRows([], { liveVersion: live })).canSign, true);
    assert.equal(agreementView(summarizeAgreementRows([], { liveVersion: live }), { signingAvailable: false }).canSign, false);
  });

  it("exposes the signature, never the file key", () => {
    const v = agreementView(summarizeAgreementRows([signedRow()], { liveVersion: live }));
    assert.equal(v.status, "signed");
    assert.equal(v.signerTitle, "Owner");
    assert.equal(v.signedVersionLabel, "November 2026");
    assert.equal(v.hasSignedFile, true);
    assert.equal(v.canSign, false);
    assert.ok(!JSON.stringify(v).includes("billing/agreements"));
  });

  it("asks for a new signature once a version requiring it goes live (PR #370 Documenso)", () => {
    const state = summarizeAgreementRows([signedRow()], { liveVersion: live, cutoff: "2026-12-01T00:00:00Z" });
    assert.equal(state.valid, false);
    const v = agreementView(state);
    assert.equal(v.status, "needs_resign");
    assert.equal(v.canSign, true);
    assert.equal(v.hasSignedFile, true, "the old signed copy stays viewable");
  });

  it("shows a copy in progress, and a decline once it ended that way", () => {
    assert.equal(agreementView(summarizeAgreementRows([{ status: "sent", provider_envelope_id: "envelope_x" }], { liveVersion: live })).status, "in_progress");
    const declined = agreementView(summarizeAgreementRows([{ status: "voided", ended_reason: "declined: terms", ended_at: "2026-11-03T00:00:00Z" }], { liveVersion: live }));
    assert.equal(declined.status, "not_signed");
    assert.equal(declined.declinedAt, "2026-11-03T00:00:00Z");
  });
});

describe("signatureStillValid", () => {
  it("counts every signature until a version asks existing signers to re-sign", () => {
    assert.equal(signatureStillValid("2026-11-01T00:00:00Z", null), true);
    assert.equal(signatureStillValid(null, null), true);
  });

  it("then counts only signatures on that version or a later one", () => {
    const cutoff = "2026-12-01T00:00:00Z";
    assert.equal(signatureStillValid("2026-11-01T00:00:00Z", cutoff), false);
    assert.equal(signatureStillValid("2026-12-01T00:00:00Z", cutoff), true);
    assert.equal(signatureStillValid("2027-01-01T00:00:00Z", cutoff), true);
    assert.equal(signatureStillValid(null, cutoff), false, "a paper signature from before any version");
  });
});

describe("cleanSignerTitle", () => {
  it("needs a title of sensible length", () => {
    assert.equal(cleanSignerTitle("  Property Manager "), "Property Manager");
    assert.throws(() => cleanSignerTitle(" "), /Enter your title/);
    assert.throws(() => cleanSignerTitle("x".repeat(101)), /under 100/);
  });
});

describe("markAgreementSigned validation", () => {
  const db = { from() { throw new Error("should not reach the database"); } };

  it("needs a signer and a believable date before it touches anything", async () => {
    await assert.rejects(() => markAgreementSigned(db, { userId: "u", signerName: "  " }), /Who signed/);
    await assert.rejects(() => markAgreementSigned(db, { userId: "u", signerName: "Pat", signedAt: "not a date" }), /not a valid signing date/);
    await assert.rejects(() => markAgreementSigned(db, { userId: "u", signerName: "Pat", signedAt: new Date(Date.now() + 5 * 86400000) }), /cannot be in the future/);
  });
});

describe("signed agreement files", () => {
  const pdf = (size = 100) => {
    const bytes = new Uint8Array(size);
    bytes.set([0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-
    return bytes;
  };

  it("accepts a PDF within the limit", () => {
    assert.doesNotThrow(() => validateSignedPdf(pdf()));
    assert.doesNotThrow(() => validateSignedPdf(pdf(MAX_SIGNED_PDF_BYTES)));
  });

  it("refuses an empty file, an oversized one, and anything that is not a PDF", () => {
    assert.throws(() => validateSignedPdf(new Uint8Array(0)), /empty/);
    assert.throws(() => validateSignedPdf(pdf(MAX_SIGNED_PDF_BYTES + 1)), /4 MB/);
    assert.throws(() => validateSignedPdf(new TextEncoder().encode("<html>not a pdf</html>")), /must be a PDF/);
    assert.throws(() => validateSignedPdf(undefined), /empty/);
  });

  it("builds the storage key only from ids, so nothing typed can steer the path", () => {
    const user = "11111111-1111-4111-8111-111111111111";
    const file = "22222222-2222-4222-8222-222222222222";
    assert.equal(signedAgreementKey(user, file), `billing/agreements/${user}/${file}.pdf`);
    assert.throws(() => signedAgreementKey("../../etc", file));
    assert.throws(() => signedAgreementKey(user, "x/../y"));
  });
});

