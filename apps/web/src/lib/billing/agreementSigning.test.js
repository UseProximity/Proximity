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

// ── An in-memory stand-in for the Supabase calls these paths make ──────────

const UNIQUE = {
  billing_settings: [(r) => r.key],
  landlord_agreements: [
    (r) => (["not_sent", "sent"].includes(r.status) ? `pending:${r.user_id}` : null),
    (r) => (r.status === "signed" ? `signed:${r.user_id}` : null),
  ],
  agreement_versions: [(r) => (r.status === "live" ? "live" : null)],
};

function fakeDb(tables = {}) {
  let nextId = 1;
  const rows = (t) => (tables[t] ??= []);
  const pick = (r, path) => path.split("->>").reduce((v, k) => (v == null ? v : v[k]), r);
  const violates = (table, candidate, self) =>
    (UNIQUE[table] ?? []).some((key) => {
      const k = key(candidate);
      return k != null && rows(table).some((r) => r !== self && key(r) === k);
    });

  function query(table) {
    const filters = [];
    let op = { kind: "select" };
    let single = null;
    const api = {
      select() { return api; },
      eq(c, v) { filters.push((r) => pick(r, c) === v); return api; },
      neq(c, v) { filters.push((r) => pick(r, c) !== v); return api; },
      in(c, vs) { filters.push((r) => vs.includes(r[c])); return api; },
      is(c, v) { filters.push((r) => (r[c] ?? null) === v); return api; },
      not(c, _o, v) { filters.push((r) => (r[c] ?? null) !== v); return api; },
      or() { return api; },
      order() { return api; },
      limit() { return api; },
      range() { return api; },
      insert(row) { op = { kind: "insert", row }; return api; },
      upsert(row, { onConflict } = {}) {
        const existing = rows(table).find((r) => r[onConflict] === row[onConflict]);
        if (existing) Object.assign(existing, row);
        else rows(table).push({ ...row });
        return Promise.resolve({ error: null });
      },
      update(patch) { op = { kind: "update", patch }; return api; },
      delete() { op = { kind: "delete" }; return api; },
      maybeSingle() { single = "maybe"; return api.run(); },
      single() { single = "one"; return api.run(); },
      then(res, rej) { return api.run().then(res, rej); },
      async run() {
        let data;
        if (op.kind === "insert") {
          const row = { id: `${table}-${nextId++}`, created_at: new Date().toISOString(), ...op.row };
          if (violates(table, row, null)) return { data: null, error: { code: "23505" } };
          rows(table).push(row);
          data = [row];
        } else {
          const hit = rows(table).filter((r) => filters.every((f) => f(r)));
          if (op.kind === "update") {
            for (const r of hit) if (violates(table, { ...r, ...op.patch }, r)) return { data: null, error: { code: "23505" } };
            hit.forEach((r) => Object.assign(r, op.patch));
          }
          if (op.kind === "delete") tables[table] = rows(table).filter((r) => !hit.includes(r));
          data = hit;
        }
        if (single) return { data: data[0] ?? null, error: single === "one" && !data[0] ? { code: "PGRST116" } : null };
        return { data, error: null };
      },
    };
    return api;
  }
  return { tables, from: query };
}

// A fake Documenso: one template, copies made from it, and their state.
function fakeDocumenso() {
  const envelopes = new Map();
  const calls = { copies: 0, cancelled: [], downloads: 0, lastCopy: null };
  let n = 0;
  return {
    calls,
    envelopes,
    async createSigningCopy(input) {
      calls.copies += 1;
      calls.lastCopy = input;
      const id = `envelope_${++n}`;
      envelopes.set(id, {
        id,
        status: "PENDING",
        envelopeItems: [{ id: `item_${n}`, order: 1 }],
        recipients: [{ id: 1, role: "SIGNER", name: input.name, email: input.email, token: `token_${n}`, signedAt: null }],
      });
      return { envelopeId: id, token: `token_${n}` };
    },
    async getEnvelope(id) {
      return structuredClone(envelopes.get(id));
    },
    async cancel(id) {
      calls.cancelled.push(id);
      envelopes.get(id).status = "CANCELLED";
    },
    async downloadSigned() {
      calls.downloads += 1;
      return new Uint8Array([37, 80, 68, 70, 45]);
    },
    complete(id, signedAt = "2026-11-03T15:00:00.000Z") {
      const e = envelopes.get(id);
      e.status = "COMPLETED";
      e.recipients[0].signedAt = signedAt;
      e.recipients[0].signingStatus = "SIGNED";
    },
    reject(id, reason) {
      const e = envelopes.get(id);
      e.status = "REJECTED";
      e.recipients[0].rejectionReason = reason;
    },
  };
}

const LIVE = {
  id: "v1",
  label: "December 2026",
  status: "live",
  requires_resign: false,
  published_at: "2026-12-01T00:00:00Z",
  provider_template_id: "envelope_template",
  provider_recipient_id: 11,
  provider_title_field_id: 42,
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

  it("makes a landlord's copy, fills in their title, and distributes it silently for the embed", async () => {
    const { sent, fetchImpl } = recordingFetch([
      { body: { id: "envelope_c1" } },
      { body: { success: true, id: "envelope_c1", recipients: [{ id: 1, role: "SIGNER", token: "tok", signingUrl: "x" }] } },
    ]);
    const client = createDocumensoClient({ apiKey: "k", fetchImpl });
    const copy = await client.createSigningCopy({ templateId: "envelope_t", recipientId: 11, email: "a@b.c", name: "A", externalId: "x", titleFieldId: 42, signerTitle: "Owner" });
    assert.deepEqual(copy, { envelopeId: "envelope_c1", token: "tok" });
    const used = JSON.parse(sent[0].init.body.get("payload"));
    assert.equal(used.envelopeId, "envelope_t");
    assert.deepEqual(used.recipients, [{ id: 11, email: "a@b.c", name: "A" }]);
    assert.deepEqual(used.prefillFields, [{ id: 42, type: "text", value: "Owner" }]);
    assert.equal(used.distributeDocument, false);
    assert.ok(sent[1].url.endsWith("/envelope/distribute"));
    assert.deepEqual(JSON.parse(sent[1].init.body), { envelopeId: "envelope_c1", meta: { distributionMethod: "NONE" } });
  });

  it("switches off every Documenso email when asked (staging, previews, local)", async () => {
    const { sent, fetchImpl } = recordingFetch([
      { body: { id: "envelope_c2" } },
      { body: { success: true, id: "envelope_c2", recipients: [{ id: 1, role: "SIGNER", token: "tok" }] } },
    ]);
    const client = createDocumensoClient({ apiKey: "k", fetchImpl, emailSettings: DOCUMENSO_EMAILS_OFF });
    await client.createSigningCopy({ templateId: "t", recipientId: 1, email: "a@b.c", name: "A", externalId: "x" });
    const meta = JSON.parse(sent[1].init.body).meta;
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
    assert.deepEqual(templateFieldSummary(envelope), { recipientId: 11, signature: 1, name: 0, date: 1, titleFieldId: 3, ok: true });
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
    const again = await sign(db, documenso, { signerTitle: "Manager" });
    assert.equal(again.token, "token_1");
    assert.equal(documenso.calls.copies, 1);
    assert.equal(db.tables.landlord_agreements.length, 1);
    assert.equal(db.tables.landlord_agreements[0].signer_title, "Manager");
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
    assert.equal(stored[0].userId, "u1");
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
