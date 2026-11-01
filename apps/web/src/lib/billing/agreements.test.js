/*
 * Run with: npm test (from apps/web).
 *
 * The rules that need neither a database nor a bucket. The gate and agreement
 * records against the real database are exercised separately in the dev
 * environment.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { agreementView, markAgreementSigned } from "./agreements.js";
import { gateDecision, gateMessage, gateResponseBody } from "./listingGate.js";
import { MAX_SIGNED_PDF_BYTES, signedAgreementKey, validateSignedPdf } from "./agreementPdf.js";
import { getAgreementProvider, manualProvider, registerAgreementProvider } from "./agreementProviders.js";

const ON = { requirePaymentMethod: true, requireAgreement: true };

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
    assert.match(gateMessage(["agreement"]), /sign the commission agreement/);
    const both = gateMessage(["payment_method", "agreement"]);
    assert.match(both, /add an active payment method and sign the commission agreement/);
    assert.match(both, /Payments/);
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
  it("reads as 'none' before any record exists", () => {
    assert.deepEqual(agreementView(null), { status: "none", version: null, signedAt: null, signerName: null, hasSignedFile: false });
  });

  it("exposes status and signing details, never the file key", () => {
    const v = agreementView({ status: "signed", version: "2026-11", signed_at: "2026-11-02T12:00:00Z", signer_name: "Pat", signed_file_key: "billing/agreements/u/f.pdf" });
    assert.deepEqual(v, { status: "signed", version: "2026-11", signedAt: "2026-11-02T12:00:00Z", signerName: "Pat", hasSignedFile: true });
    assert.ok(!JSON.stringify(v).includes("billing/agreements"));
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

describe("agreement providers", () => {
  it("starts with only the manual provider, which does nothing by itself", () => {
    assert.equal(getAgreementProvider().name, "manual");
    assert.throws(() => manualProvider.sendForSignature(), /by hand/);
    assert.throws(() => getAgreementProvider("docusign"), /Unknown agreement provider/);
  });

  it("accepts a complete adapter and rejects an incomplete one", () => {
    assert.throws(() => registerAgreementProvider({ name: "half", sendForSignature() {} }), /missing getStatus/);
    assert.throws(() => registerAgreementProvider({ sendForSignature() {}, getStatus() {}, parseWebhook() {} }), /needs a name/);
    const adapter = { name: "test-provider", sendForSignature: async () => ({ envelopeId: "e1" }), getStatus: async () => "sent", parseWebhook: async () => null };
    registerAgreementProvider(adapter);
    assert.equal(getAgreementProvider("test-provider"), adapter);
  });
});
