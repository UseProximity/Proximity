/*
 * Run with: npm test (from apps/web).
 *
 * Signing the commission agreement in the app through Documenso, against a fake
 * Documenso and an in-memory database: the request shapes we send Documenso, the
 * webhook secret, starting and resuming a signing, finishing it (signed, declined,
 * cancelled), the enrollment deadline switching the requirements on, and the admin
 * overview's rules. None of it needs Documenso credentials.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DOCUMENSO_EMAILS_OFF,
  createDocumensoClient,
  documensoSetting,
  templateEditorUrl,
  templateFieldSummary,
  verifyWebhookSecret,
} from "./documenso.js";
import { applyEnvelope, startSigning } from "./agreements.js";
import { publishVersion } from "./agreementVersions.js";
import { chicagoDate, enforceEnrollmentDeadline } from "./enrollment.js";
import { BULK_RESEND_GAP_MS, bulkAudience, invoiceSummary, paymentSummary, singleTarget } from "./landlordOverview.js";

import { fakeDb, fakeDocumenso } from "./billingFakes.testutil.js";

const LIVE = {
  id: "v1",
  label: "December 2026",
  status: "live",
  kind: "master",
  landlord_id: null,
  commission_rate_percent: 8,
  requires_resign: false,
  published_at: "2026-12-01T00:00:00Z",
  provider_template_id: "envelope_template",
  provider_recipient_id: 11,
  provider_title_field_id: 42,
  provider_rate_field_id: 43,
  provider_brokerage_field_id: 44,
  provider_license_field_id: 45,
};
const user = { id: "u1", name: "Pat Landlord", email: "pat@example.com" };
const sign = (db, documenso, over = {}) =>
  startSigning(db, documenso, { user, signerTitle: "Owner", authorized: true, ...over });

// ── Documenso client ────────────────────────────────────────────────────────

describe("Documenso client requests", () => {
  function recordingFetch(responses) {
    const sent = [];
    const fetchImpl = async (url, init) => {
      sent.push({ url, init });
      const next = responses.shift();
      return {
        ok: next.status ? next.status < 400 : true,
        status: next.status ?? 200,
        json: async () => next.body,
        text: async () => JSON.stringify(next.body ?? {}),
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      };
    };
    return { sent, fetchImpl };
  }

  it("creates a template from the PDF with a placeholder signer and no Documenso emails", async () => {
    const { sent, fetchImpl } = recordingFetch([{ body: { id: "envelope_t1" } }]);
    const client = createDocumensoClient({ apiKey: "api_test", host: "https://docs.example", fetchImpl });
    const id = await client.createTemplate({ title: "T", pdfBytes: new Uint8Array([37]), fileName: "a.pdf", externalId: "agreement-version:v1" });
    assert.equal(id, "envelope_t1");
    assert.equal(sent[0].url, "https://docs.example/api/v2/envelope/create");
    assert.equal(sent[0].init.headers.Authorization, "api_test");
    const payload = JSON.parse(sent[0].init.body.get("payload"));
    assert.equal(payload.type, "TEMPLATE");
    assert.equal(payload.recipients[0].role, "SIGNER");
    assert.equal(payload.meta.distributionMethod, "NONE");
    assert.ok(sent[0].init.body.get("files"), "the PDF goes in the files part");
  });

  const COPY = { recipients: [{ id: 1, role: "SIGNER" }], fields: [] };

  it("makes a landlord's copy, fills in their title, and distributes it silently for the embed", async () => {
    const { sent, fetchImpl } = recordingFetch([
      { body: { id: "envelope_c1" } },
      { body: COPY },
      { body: { success: true, id: "envelope_c1", recipients: [{ id: 1, role: "SIGNER", token: "tok", signingUrl: "x" }] } },
    ]);
    const client = createDocumensoClient({ apiKey: "k", fetchImpl });
    const copy = await client.createSigningCopy({ templateId: "envelope_t", recipientId: 11, email: "a@b.c", name: "A", externalId: "x", titleFieldId: 42, signerTitle: "Owner" });
    assert.deepEqual(copy, { envelopeId: "envelope_c1", token: "tok", exhibitItemId: null });
    const used = JSON.parse(sent[0].init.body.get("payload"));
    assert.equal(used.envelopeId, "envelope_t");
    assert.deepEqual(used.recipients, [{ id: 11, email: "a@b.c", name: "A" }]);
    assert.deepEqual(used.prefillFields, [{ id: 42, type: "text", value: "Owner" }]);
    assert.equal(used.distributeDocument, false);
    assert.equal(used.override.dateFormat, "MM/dd/yyyy", "dates without a time");
    assert.equal(used.override.timezone, "America/Chicago");
    assert.ok(sent[2].url.endsWith("/envelope/distribute"));
    assert.deepEqual(JSON.parse(sent[2].init.body), { envelopeId: "envelope_c1", meta: { distributionMethod: "NONE" } });
  });

  it("swaps Documenso's Name, Email and Date boxes for read-only text holding the value", async () => {
    const box = (id, type) => ({ id, type, recipientId: 1, envelopeItemId: "item_1", page: 2, positionX: "10", positionY: "80", width: "12", height: "3", fieldMeta: { fontSize: 11 } });
    const { sent, fetchImpl } = recordingFetch([
      { body: { id: "envelope_c3" } },
      { body: { ...COPY, fields: [box(5, "NAME"), box(6, "DATE"), box(7, "SIGNATURE")] } },
      { body: {} },
      { body: {} },
      { body: {} },
    ]);
    const client = createDocumensoClient({ apiKey: "k", fetchImpl });
    await client.prepareSigningCopy({ templateId: "t", recipientId: 1, email: "a@b.c", name: "Pat Landlord", externalId: "x", autofill: { name: "Pat Landlord", email: "a@b.c", date: "11/05/2026" } });
    assert.deepEqual(sent.slice(2, 4).map((r) => JSON.parse(r.init.body).fieldId), [5, 6], "the Name and Date boxes are removed, the signature stays");
    const made = JSON.parse(sent[4].init.body).data;
    assert.deepEqual(made.map((f) => [f.type, f.fieldMeta.text, f.fieldMeta.readOnly, f.page, f.positionX]), [
      ["TEXT", "Pat Landlord", true, 2, 10],
      ["TEXT", "11/05/2026", true, 2, 10],
    ]);
    assert.equal(sent.length, 5, "prepared only: nothing distributed yet");
  });

  it("opening a prepared copy fills the licensee boxes read-only, then distributes", async () => {
    const { sent, fetchImpl } = recordingFetch([
      { body: { fields: [{ id: 9, type: "TEXT", fieldMeta: { label: "Brokerage", type: "text" } }] } },
      { body: {} },
      { body: { recipients: [{ id: 1, role: "SIGNER", token: "tok" }] } },
    ]);
    const client = createDocumensoClient({ apiKey: "k", fetchImpl });
    assert.deepEqual(await client.finishSigningCopy({ envelopeId: "e", fill: [{ id: 9, value: "N/A" }, { id: null, value: "x" }] }), { token: "tok" });
    const updated = JSON.parse(sent[1].init.body).data[0];
    assert.deepEqual(updated, { id: 9, type: "TEXT", fieldMeta: { label: "Brokerage", type: "text", text: "N/A", readOnly: true } });
    assert.ok(sent[2].url.endsWith("/envelope/distribute"));
  });

  it("withdraws a draft by deleting it, since Documenso only cancels sent copies", async () => {
    const { sent, fetchImpl } = recordingFetch([{ status: 400, body: { message: "Only pending documents can be cancelled" } }, { body: {} }]);
    const client = createDocumensoClient({ apiKey: "k", fetchImpl });
    await client.discard("envelope_d", "Replaced");
    assert.ok(sent[0].url.endsWith("/envelope/cancel"));
    assert.ok(sent[1].url.endsWith("/envelope/delete"));
  });

  it("switches off every Documenso email when asked (staging, previews, local)", async () => {
    const { sent, fetchImpl } = recordingFetch([
      { body: { id: "envelope_c2" } },
      { body: COPY },
      { body: { success: true, id: "envelope_c2", recipients: [{ id: 1, role: "SIGNER", token: "tok" }] } },
    ]);
    const client = createDocumensoClient({ apiKey: "k", fetchImpl, emailSettings: DOCUMENSO_EMAILS_OFF });
    await client.createSigningCopy({ templateId: "t", recipientId: 1, email: "a@b.c", name: "A", externalId: "x" });
    const meta = JSON.parse(sent[2].init.body).meta;
    assert.equal(meta.distributionMethod, "NONE");
    assert.ok(Object.values(meta.emailSettings).every((v) => v === false));
    assert.equal(Object.keys(meta.emailSettings).length, 9);
  });

  it("downloads the signed version of the envelope's first document", async () => {
    const { sent, fetchImpl } = recordingFetch([{ body: null }]);
    const client = createDocumensoClient({ apiKey: "k", fetchImpl });
    const bytes = await client.downloadSigned({ envelopeItems: [{ id: "item_b", order: 2 }, { id: "item_a", order: 1 }] });
    assert.ok(sent[0].url.endsWith("/envelope/item/item_a/download?version=signed"));
    assert.deepEqual([...bytes], [1, 2, 3]);
  });

  it("refuses to call Documenso without an API key, and reports its errors with the status", async () => {
    await assert.rejects(() => createDocumensoClient({ apiKey: "" }).getEnvelope("x"), (e) => e.name === "DocumensoError" && e.status === 503);
    const { fetchImpl } = recordingFetch([{ status: 404, body: { message: "Envelope not found" } }]);
    await assert.rejects(() => createDocumensoClient({ apiKey: "k", fetchImpl }).getEnvelope("x"), (e) => e.status === 404 && /Envelope not found/.test(e.message));
  });
});

describe("one Documenso team for every environment", () => {
  it("files test documents in this environment's folder, labelled [TEST] and tagged with the environment", async () => {
    const sent = [];
    const fetchImpl = async (url, init) => {
      sent.push({ url, init });
      const body = url.endsWith("/distribute")
        ? { success: true, id: "envelope_c", recipients: [{ id: 1, role: "SIGNER", token: "tok" }] }
        : init.method === "GET"
          ? { recipients: [{ id: 1, role: "SIGNER" }], fields: [] }
          : { id: url.endsWith("/use") ? "envelope_c" : "envelope_t" };
      return { ok: true, status: 200, json: async () => body, text: async () => "" };
    };
    const client = createDocumensoClient({ apiKey: "k", fetchImpl, folderId: "folder_test", titlePrefix: "[TEST] ", envTag: "staging" });
    await client.createTemplate({ title: "Proximity commission agreement (Dec)", pdfBytes: new Uint8Array([37]), externalId: "agreement-version:v1" });
    await client.createSigningCopy({ templateId: "envelope_t", recipientId: 1, email: "pat@x.com", name: "Pat", externalId: "landlord-agreement:a1" });
    const template = JSON.parse(sent[0].init.body.get("payload"));
    assert.equal(template.title, "[TEST] Proximity commission agreement (Dec)");
    assert.equal(template.folderId, undefined, "templates are not filed in the document folder");
    assert.equal(template.externalId, "staging:agreement-version:v1");
    const copy = JSON.parse(sent[1].init.body.get("payload"));
    assert.equal(copy.override.title, "[TEST] Commission agreement: Pat (pat@x.com)");
    assert.equal(copy.folderId, "folder_test");
    assert.equal(copy.externalId, "staging:landlord-agreement:a1");
  });
});

describe("which Documenso settings an environment reads", () => {
  it("never reads the production settings off production, even when both are present", () => {
    const saved = { ...process.env };
    try {
      Object.assign(process.env, { DOCUMENSO_API_KEY: "prod", DOCUMENSO_API_KEY_DEV: "dev", APP_ENV: "development" });
      assert.equal(documensoSetting("DOCUMENSO_API_KEY"), "dev");
      delete process.env.DOCUMENSO_API_KEY_DEV;
      assert.equal(documensoSetting("DOCUMENSO_API_KEY"), null, "no fallback to the production key");
      process.env.APP_ENV = "staging";
      assert.equal(documensoSetting("DOCUMENSO_API_KEY"), null);
      process.env.APP_ENV = "production";
      assert.equal(documensoSetting("DOCUMENSO_API_KEY"), "prod");
    } finally {
      for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
      Object.assign(process.env, saved);
    }
  });
});

describe("Documenso webhook secret", () => {
  it("accepts only the exact secret, and nothing when none is configured", () => {
    assert.equal(verifyWebhookSecret("s3cret", "s3cret"), true);
    assert.equal(verifyWebhookSecret("s3cret!", "s3cret"), false);
    assert.equal(verifyWebhookSecret("", "s3cret"), false);
    assert.equal(verifyWebhookSecret(null, "s3cret"), false);
    assert.equal(verifyWebhookSecret("anything", ""), false);
  });
});

describe("template checks", () => {
  const envelope = {
    id: "envelope_t",
    team: { url: "proximity" },
    recipients: [{ id: 11, role: "SIGNER" }, { id: 12, role: "CC" }],
    fields: [
      { id: 1, type: "SIGNATURE", recipientId: 11 },
      { id: 2, type: "DATE", recipientId: 11 },
      { id: 3, type: "TEXT", recipientId: 11, fieldMeta: { label: "Title" } },
      { id: 4, type: "SIGNATURE", recipientId: 12 },
    ],
  };

  it("finds the signer's boxes and the Title box", () => {
    assert.deepEqual(templateFieldSummary(envelope), {
      recipientId: 11,
      signature: 1,
      name: 0,
      date: 1,
      titleFieldId: 3,
      rateFieldId: null,
      addressFieldId: null,
      nameFieldId: null,
      companyFieldId: null,
      ownerFieldId: null,
      brokerageFieldId: null,
      licenseFieldId: null,
      fields: { title: { id: 3, type: "text", readOnly: false }, rate: null, address: null, name: null, company: null, owner: null, brokerage: null, license: null },
      rateReadOnly: null,
      allIds: { title: [3], address: [], name: [], company: [], owner: [] },
      ok: true,
    });
  });

  it("takes the only Number box as the commission rate, even with no label (Wyatt 2026-11-05)", () => {
    const s = templateFieldSummary({ ...envelope, fields: [...envelope.fields, { id: 7, type: "NUMBER", recipientId: 11, fieldMeta: { label: "", readOnly: false } }] });
    assert.equal(s.rateFieldId, 7);
    assert.deepEqual(s.fields.rate, { id: 7, type: "number", readOnly: false });
    assert.equal(s.rateReadOnly, false);
  });

  it("prefers a box labelled Commission or Rate over a lone Number box, and finds a Name text box", () => {
    const s = templateFieldSummary({
      ...envelope,
      fields: [
        ...envelope.fields,
        { id: 7, type: "NUMBER", recipientId: 11, fieldMeta: { label: "Units" } },
        { id: 8, type: "TEXT", recipientId: 11, fieldMeta: { label: "Rate", readOnly: true } },
        { id: 9, type: "TEXT", recipientId: 11, fieldMeta: { label: "Company name" } },
        { id: 10, type: "TEXT", recipientId: 11, fieldMeta: { label: "Full name" } },
      ],
    });
    assert.equal(s.rateFieldId, 8);
    assert.equal(s.rateReadOnly, true);
    assert.equal(s.nameFieldId, 10, "a company name box is not the signer's name");
  });

  it("finds the signature page's Brokerage and License boxes, and neither is taken for the signer's name", () => {
    const s = templateFieldSummary({
      ...envelope,
      fields: [
        ...envelope.fields,
        { id: 8, type: "TEXT", recipientId: 11, fieldMeta: { label: "Brokerage name" } },
        { id: 9, type: "TEXT", recipientId: 11, fieldMeta: { label: "Missouri License #" } },
      ],
    });
    assert.equal(s.brokerageFieldId, 8);
    assert.equal(s.licenseFieldId, 9);
    assert.equal(s.nameFieldId, null);
  });

  it("with two unlabelled Number boxes, guesses neither", () => {
    const n = (id) => ({ id, type: "NUMBER", recipientId: 11, fieldMeta: {} });
    assert.equal(templateFieldSummary({ ...envelope, fields: [...envelope.fields, n(7), n(8)] }).rateFieldId, null);
  });

  it("is not ready without a signature box for the signer", () => {
    assert.equal(templateFieldSummary({ ...envelope, fields: [{ id: 4, type: "SIGNATURE", recipientId: 12 }] }).ok, false);
    assert.equal(templateFieldSummary({ recipients: [], fields: [] }).ok, false);
  });

  it("links to the template in the team's editor", () => {
    assert.equal(templateEditorUrl(envelope, "https://app.documenso.com"), "https://app.documenso.com/t/proximity/templates/envelope_t/edit");
    assert.equal(templateEditorUrl({ id: "x" }, "https://app.documenso.com"), "https://app.documenso.com/");
  });
});

// ── Signing ─────────────────────────────────────────────────────────────────

describe("startSigning: the license answer is not printed on the agreement (2026-11-06)", () => {
  it("fills no Brokerage or License box, even on a template that has them", async () => {
    const db = fakeDb({ agreement_versions: [{ ...LIVE }] });
    const documenso = fakeDocumenso();
    documenso.envelopes.set("envelope_template", {
      id: "envelope_template",
      recipients: [{ id: 11, role: "SIGNER" }],
      fields: [
        { id: 1, type: "SIGNATURE", recipientId: 11 },
        { id: 44, type: "TEXT", recipientId: 11, fieldMeta: { label: "Brokerage" } },
        { id: 45, type: "TEXT", recipientId: 11, fieldMeta: { label: "License" } },
      ],
    });
    await sign(db, documenso, { licenseDisclosure: { is_licensee: true, company_name: "West End Realty", license_number: "2026001234" } });
    const filled = (await documenso.getEnvelope("envelope_1")).fields.filter((f) => f.fieldMeta?.text);
    assert.deepEqual(filled, []);
    assert.deepEqual(documenso.calls.lastFill, []);
  });
});

describe("startSigning", () => {
  it("makes the landlord's copy of the live version and returns the token", async () => {
    const db = fakeDb({ agreement_versions: [{ ...LIVE }] });
    const documenso = fakeDocumenso();
    const r = await sign(db, documenso);
    assert.equal(r.token, "token_1");
    assert.equal(documenso.calls.lastCopy.templateId, "envelope_template");
    assert.equal(documenso.calls.lastCopy.recipientId, 11);
    assert.equal(documenso.calls.lastCopy.signerTitle, "Owner");
    const row = db.tables.landlord_agreements[0];
    assert.equal(row.status, "sent");
    assert.equal(row.version_id, "v1");
    assert.equal(row.provider_envelope_id, "envelope_1");
    assert.equal(row.signer_title, "Owner");
    assert.ok(row.authorized_at);
    assert.equal(db.tables.billing_settings.length, 0, "the signing lock is released");
  });

  it("reuses the copy in progress instead of making a second one", async () => {
    const db = fakeDb({ agreement_versions: [{ ...LIVE }] });
    const documenso = fakeDocumenso();
    await sign(db, documenso);
    const again = await sign(db, documenso);
    assert.equal(again.token, "token_1");
    assert.equal(documenso.calls.copies, 1);
    assert.equal(db.tables.landlord_agreements.length, 1);
  });

  it("a changed title makes a fresh copy, so the document shows what they typed (2026-11-05)", async () => {
    const db = fakeDb({ agreement_versions: [{ ...LIVE }] });
    const documenso = fakeDocumenso();
    await sign(db, documenso);
    const again = await sign(db, documenso, { signerTitle: "Manager" });
    assert.equal(again.token, "token_2");
    assert.deepEqual(documenso.calls.cancelled, ["envelope_1"]);
    assert.equal(documenso.calls.lastCopy.signerTitle, "Manager");
  });

  it("replaces a copy of an older version, cancelling it in Documenso", async () => {
    const db = fakeDb({ agreement_versions: [{ ...LIVE }] });
    const documenso = fakeDocumenso();
    await sign(db, documenso);
    db.tables.agreement_versions[0].status = "retired";
    db.tables.agreement_versions.push({ ...LIVE, id: "v2", label: "January 2027", provider_template_id: "envelope_t2" });
    const r = await sign(db, documenso);
    assert.equal(r.token, "token_2");
    assert.deepEqual(documenso.calls.cancelled, ["envelope_1"]);
    const statuses = db.tables.landlord_agreements.map((a) => [a.version_id, a.status]);
    assert.deepEqual(statuses, [["v1", "voided"], ["v2", "sent"]]);
  });

  it("answers already signed when the copy was finished meanwhile", async () => {
    const db = fakeDb({ agreement_versions: [{ ...LIVE }] });
    const documenso = fakeDocumenso();
    await sign(db, documenso);
    documenso.complete("envelope_1");
    assert.deepEqual(await sign(db, documenso), { alreadySigned: true });
    assert.equal(db.tables.landlord_agreements[0].status, "signed");
  });

  it("needs the title, the authorisation and a live version", async () => {
    const db = fakeDb({ agreement_versions: [{ ...LIVE }] });
    await assert.rejects(() => sign(db, fakeDocumenso(), { authorized: false }), (e) => e.code === "authorization_required");
    await assert.rejects(() => sign(db, fakeDocumenso(), { signerTitle: " " }), (e) => e.code === "title_required");
    await assert.rejects(() => sign(fakeDb(), fakeDocumenso()), (e) => e.code === "not_available");
  });
});

describe("applyEnvelope", () => {
  async function started() {
    const db = fakeDb({ agreement_versions: [{ ...LIVE }] });
    const documenso = fakeDocumenso();
    await sign(db, documenso);
    return { db, documenso };
  }

  it("stores the signed PDF and marks the agreement signed, once", async () => {
    const { db, documenso } = await started();
    documenso.complete("envelope_1", "2026-12-03T10:00:00.000Z");
    const stored = [];
    const storeSigned = async ({ userId, bytes }) => {
      stored.push({ userId, bytes });
      return `billing/agreements/${userId}/x.pdf`;
    };
    const envelope = await documenso.getEnvelope("envelope_1");
    assert.equal(await applyEnvelope(db, documenso, envelope, { storeSigned }), "signed");
    const row = db.tables.landlord_agreements[0];
    assert.equal(row.status, "signed");
    assert.equal(row.signed_at, "2026-12-03T10:00:00.000Z");
    assert.equal(row.signer_name, "Pat Landlord");
    assert.equal(row.signed_file_key, "billing/agreements/u1/x.pdf");
    assert.equal(row.signed_exhibit_file_key, "billing/agreements/u1/x.pdf", "the signed Exhibit A is kept too");
    assert.equal(row.term_end, undefined, "no end date is stored (2026-11-06)");
    assert.equal(stored[0].userId, "u1");
    assert.equal(stored.length, 2);
    // A redelivered webhook changes nothing and stores nothing again.
    assert.equal(await applyEnvelope(db, documenso, envelope, { storeSigned }), "unchanged");
    assert.equal(documenso.calls.downloads, 1);
  });

  it("keeps the earlier signature as superseded when the landlord re-signs", async () => {
    const { db, documenso } = await started();
    db.tables.landlord_agreements.unshift({ id: "old", user_id: "u1", status: "signed", version_id: "v0", signed_at: "2026-11-01" });
    documenso.complete("envelope_1");
    await applyEnvelope(db, documenso, await documenso.getEnvelope("envelope_1"));
    assert.deepEqual(db.tables.landlord_agreements.map((a) => a.status), ["superseded", "signed"]);
  });

  it("voids a declined copy with the reason and tells the team", async () => {
    const { db, documenso } = await started();
    documenso.reject("envelope_1", "The fee is too high");
    const told = [];
    db.tables.users = [{ id: "u1", name: "Pat", email: "pat@example.com" }];
    const r = await applyEnvelope(db, documenso, await documenso.getEnvelope("envelope_1"), { notify: { declined: async (x) => told.push(x) } });
    assert.equal(r, "declined");
    assert.equal(db.tables.landlord_agreements[0].status, "voided");
    assert.equal(db.tables.landlord_agreements[0].ended_reason, "declined: The fee is too high");
    assert.equal(told[0].reason, "The fee is too high");
  });

  it("ignores an envelope that is not one of ours", async () => {
    const { db, documenso } = await started();
    assert.equal(await applyEnvelope(db, documenso, { id: "envelope_other", status: "COMPLETED" }), "unknown");
  });
});

describe("publishVersion", () => {
  it("retires the live version and makes the ready one live, with the re-sign choice", async () => {
    const db = fakeDb({ agreement_versions: [{ ...LIVE }, { ...LIVE, id: "v2", status: "ready", published_at: null }] });
    const v = await publishVersion(db, { versionId: "v2", adminId: "a", requiresResign: true, now: new Date("2027-01-01T00:00:00Z") });
    assert.equal(v.status, "live");
    assert.equal(v.requires_resign, true);
    assert.deepEqual(db.tables.agreement_versions.map((x) => x.status), ["retired", "live"]);
  });

  it("makes a version live with no commission rate: the rate is only in the document (2026-11-06)", async () => {
    const db = fakeDb({ agreement_versions: [{ ...LIVE, id: "v2", status: "ready", published_at: null, commission_rate_percent: null }] });
    const v = await publishVersion(db, { versionId: "v2", adminId: "a", requiresResign: false });
    assert.equal(v.status, "live");
  });

  it("makes an agreement live without Brokerage and License boxes: that info is not on the agreement", async () => {
    const db = fakeDb({ agreement_versions: [{ ...LIVE, id: "v2", status: "ready", published_at: null, provider_brokerage_field_id: null, provider_license_field_id: null }] });
    const v = await publishVersion(db, { versionId: "v2", adminId: "a", requiresResign: false });
    assert.equal(v.status, "live");
  });

  it("needs the re-sign choice and a checked version", async () => {
    const db = fakeDb({ agreement_versions: [{ ...LIVE, id: "v2", status: "draft", published_at: null }] });
    await assert.rejects(() => publishVersion(db, { versionId: "v2", adminId: "a" }), (e) => e.code === "resign_choice_required");
    await assert.rejects(() => publishVersion(db, { versionId: "v2", adminId: "a", requiresResign: false }), (e) => e.code === "not_ready");
  });
});

// ── The enrollment deadline ─────────────────────────────────────────────────

describe("enforceEnrollmentDeadline (Wyatt 2026-11-02)", () => {
  const window = (over) => ({ key: "enrollment_window", value: { deadline: "2026-12-15", includeAgreement: true, enforcedAt: null, ...over } });
  const value = (db, key) => db.tables.billing_settings.find((r) => r.key === key)?.value;

  it("does nothing before the deadline (Chicago time)", async () => {
    const db = fakeDb({ billing_settings: [window()] });
    // 11pm on the 14th in Chicago is already the 15th in UTC.
    assert.equal(chicagoDate(new Date("2026-12-15T04:59:00Z")), "2026-12-14");
    assert.equal(await enforceEnrollmentDeadline(db, { now: new Date("2026-12-15T04:59:00Z") }), null);
    assert.equal(value(db, "payment_method_required"), undefined);
  });

  it("switches both requirements on at the deadline, once", async () => {
    const db = fakeDb({ billing_settings: [window()] });
    const r = await enforceEnrollmentDeadline(db, { now: new Date("2026-12-15T15:00:00Z") });
    assert.deepEqual(r.switchedOn, ["payment_method_required", "agreement_required"]);
    assert.equal(value(db, "payment_method_required"), true);
    assert.equal(value(db, "agreement_required"), true);
    assert.ok(value(db, "enrollment_window").enforcedAt);
    // An admin turns one back off: the next day's run leaves it.
    db.tables.billing_settings.find((x) => x.key === "agreement_required").value = false;
    assert.equal(await enforceEnrollmentDeadline(db, { now: new Date("2026-12-16T15:00:00Z") }), null);
    assert.equal(value(db, "agreement_required"), false);
  });

  it("leaves the agreement off when the enrollment did not ask for it", async () => {
    const db = fakeDb({ billing_settings: [window({ includeAgreement: false })] });
    const r = await enforceEnrollmentDeadline(db, { now: new Date("2026-12-20T15:00:00Z") });
    assert.deepEqual(r.switchedOn, ["payment_method_required"]);
  });
});

// ── The admin overview's rules ──────────────────────────────────────────────

describe("landlord overview", () => {
  const now = new Date("2026-11-15T12:00:00Z");

  it("sums up payment methods, active first being the default", () => {
    const s = paymentSummary(
      [
        { type: "card", status: "active", brand: "visa", last4: "4242", exp_month: 10, exp_year: 2026, is_default: true },
        { type: "us_bank_account", status: "verifying", bank_name: "Chase", last4: "6789" },
      ],
      now
    );
    assert.equal(s.state, "verifying", "an expired default and a bank still verifying is not usable yet");
    assert.equal(s.methods[0].status, "expired");
    assert.equal(paymentSummary([], now).state, "none");
  });

  it("counts unpaid issued invoices and flags an overdue one", () => {
    const s = invoiceSummary([
      { status: "open", total_cents: 1000, invoice_date: "2026-10-01", overdue_actioned_at: "2026-11-01" },
      { status: "failed", total_cents: 500, invoice_date: "2026-11-02" },
      { status: "open", total_cents: 999, invoice_date: null },
    ]);
    assert.deepEqual(s, { unpaidCount: 2, unpaidCents: 1500, failedCount: 1, overdue: true });
  });

  const row = (over) => ({
    id: "u1",
    email: "a@b.c",
    hasLiveListing: true,
    agreement: { status: "not_signed" },
    lastAgreementEmailAt: null,
    ...over,
  });

  it("emails everyone with a live listing who has not signed and was not asked in the last few days", () => {
    const rows = [
      row({ id: "a" }),
      row({ id: "b", hasLiveListing: false }),
      row({ id: "c", agreement: { status: "signed" } }),
      row({ id: "d", lastAgreementEmailAt: new Date(now.getTime() - 60_000).toISOString() }),
      row({ id: "e", lastAgreementEmailAt: new Date(now.getTime() - BULK_RESEND_GAP_MS - 1).toISOString() }),
      row({ id: "f", agreement: { status: "needs_resign" } }),
    ];
    assert.deepEqual(bulkAudience(rows, now).map((r) => r.id), ["a", "e", "f"]);
  });

  it("refuses a single resend to someone signed or just emailed", () => {
    assert.throws(() => singleTarget([row({ agreement: { status: "signed" } })], "u1", now), (e) => e.code === "already_signed");
    assert.throws(() => singleTarget([row({ lastAgreementEmailAt: now.toISOString() })], "u1", now), (e) => e.code === "just_sent");
    assert.equal(singleTarget([row()], "u1", now).id, "u1");
  });
});
