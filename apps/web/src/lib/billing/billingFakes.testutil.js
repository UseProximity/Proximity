/*
 * In-memory stand-ins for Supabase and Documenso, shared by the billing tests
 * (agreementSigning.test.js, coverage.test.js). Not a test file itself.
 *
 * The fake database applies the unique indexes and the coverage rule the real
 * migrations add, so a test fails the way production would.
 */
// ── An in-memory stand-in for the Supabase calls these paths make ──────────

const UNIQUE = {
  billing_settings: [(r) => r.key],
  landlord_agreements: [
    (r) => (["not_sent", "sent"].includes(r.status) ? `pending:${r.user_id}` : null),
    (r) => (r.status === "signed" ? `signed:${r.user_id}` : null),
  ],
  // One live standard version per kind (202611220001).
  agreement_versions: [(r) => (r.status === "live" && (r.audience ?? "everyone") === "everyone" ? `live:${r.kind ?? "master"}` : null)],
  // A landlord on a version once at a time; one live custom version per kind per landlord.
  agreement_version_landlords: [
    (r) => (r.removed_at ? null : `on:${r.version_id}:${r.landlord_id}`),
    (r) => (r.live ? `live:${r.kind}:${r.landlord_id}` : null),
  ],
  agreement_amendments: [(r) => (r.status === "sent" ? `pending:${r.user_id}` : null)],
  agreement_coverage: [(r) => (r.status !== "released" ? `${r.agreement_id}:${r.listing_id}:${r.amendment_id ?? ""}` : null)],
};

// trg_agreement_coverage_requires_signature (202611050001): an unsigned document never covers.
function coverageCheck(tables, row) {
  if (row.status !== "covered") return null;
  const doc = row.amendment_id
    ? (tables.agreement_amendments ?? []).find((a) => a.id === row.amendment_id)
    : (tables.landlord_agreements ?? []).find((a) => a.id === row.agreement_id);
  return doc?.status === "signed" ? null : { code: "23514", message: "a property is covered only by a signed document" };
}

export function fakeDb(tables = {}) {
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
      // Case-insensitive equality: enough for the exact (escaped) email matches the code makes.
      ilike(c, v) { filters.push((r) => String(r[c] ?? "").toLowerCase() === String(v).replace(/\\(.)/g, "$1").toLowerCase()); return api; },
      not(c, _o, v) { filters.push((r) => (r[c] ?? null) !== v); return api; },
      gte(c, v) { filters.push((r) => r[c] != null && String(r[c]) >= String(v)); return api; },
      or() { return api; },
      order() { return api; },
      limit() { return api; },
      range() { return api; },
      insert(row) { op = { kind: "insert", row }; return api; },
      upsert(row, { onConflict } = {}) {
        const existing = rows(table).find((r) => r[onConflict] === row[onConflict]);
        let saved = existing;
        if (existing) Object.assign(existing, row);
        else rows(table).push((saved = { ...row }));
        // Chainable like Supabase's (.select().single()), and awaitable on its own.
        const done = { data: saved, error: null };
        const chain = { select: () => chain, single: () => Promise.resolve(done), maybeSingle: () => Promise.resolve(done), then: (res, rej) => Promise.resolve({ error: null }).then(res, rej) };
        return chain;
      },
      update(patch) { op = { kind: "update", patch }; return api; },
      delete() { op = { kind: "delete" }; return api; },
      maybeSingle() { single = "maybe"; return api.run(); },
      single() { single = "one"; return api.run(); },
      then(res, rej) { return api.run().then(res, rej); },
      async run() {
        let data;
        if (op.kind === "insert") {
          const many = Array.isArray(op.row) ? op.row : [op.row];
          const made = [];
          for (const one of many) {
            // created_at increases with each insert, so "newest first" is stable.
            const row = { id: `${table}-${nextId}`, created_at: new Date(Date.UTC(2026, 10, 1) + nextId++ * 1000).toISOString(), ...one };
            if (violates(table, row, null)) return { data: null, error: { code: "23505" } };
            if (table === "agreement_coverage" && coverageCheck(tables, row)) return { data: null, error: coverageCheck(tables, row) };
            rows(table).push(row);
            made.push(row);
          }
          data = made;
        } else {
          const hit = rows(table).filter((r) => filters.every((f) => f(r)));
          if (op.kind === "update") {
            for (const r of hit) if (violates(table, { ...r, ...op.patch }, r)) return { data: null, error: { code: "23505" } };
            if (table === "agreement_coverage") {
              for (const r of hit) if (coverageCheck(tables, { ...r, ...op.patch })) return { data: null, error: coverageCheck(tables, { ...r, ...op.patch }) };
            }
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
  // The database functions the billing code calls, as the migrations define them.
  async function rpc(name, args) {
    const fn = RPC[name];
    if (!fn) return { data: null, error: { code: "PGRST202", message: `no function ${name}` } };
    // One transaction: a failure part way leaves every table as it was.
    const before = structuredClone(tables);
    try {
      return { data: await fn({ tables, from: query }, args), error: null };
    } catch (error) {
      for (const k of Object.keys(tables)) delete tables[k];
      Object.assign(tables, before);
      return { data: null, error: { code: error.code ?? "P0001", message: error.message } };
    }
  }
  return { tables, from: query, rpc };
}

const raise = (message, code) => Object.assign(new Error(message), { code });

// agreement_version_set_landlords (202611220001), step for step.
async function setLandlordsFn(db, { p_version_id, p_add, p_remove, p_admin_id, p_publish = false, p_now }) {
  const t = db.tables;
  t.agreement_version_landlords ??= [];
  const v = (t.agreement_versions ?? []).find((x) => x.id === p_version_id);
  if (!v) throw raise("not_found");
  if (v.audience !== "selected") throw raise("not_custom");
  if (v.status === "retired") throw raise("retired");
  if (p_publish && v.status !== "ready") throw raise("not_ready");
  const add = [...new Set((p_add ?? []).filter(Boolean))];
  const unique = async (q) => {
    const { error } = await q;
    if (error) throw raise("unique", error.code);
  };
  const removed = [];
  for (const r of t.agreement_version_landlords) {
    if (r.version_id === v.id && !r.removed_at && (p_remove ?? []).includes(r.landlord_id) && !add.includes(r.landlord_id)) {
      Object.assign(r, { live: false, removed_at: p_now, removed_by_id: p_admin_id });
      removed.push(r.landlord_id);
    }
  }
  for (const id of add) {
    if (t.agreement_version_landlords.some((r) => r.version_id === v.id && r.landlord_id === id && !r.removed_at)) continue;
    await unique(db.from("agreement_version_landlords").insert({ version_id: v.id, landlord_id: id, kind: v.kind, live: false, added_by_id: p_admin_id, added_at: p_now, removed_at: null }));
  }
  if (v.status !== "live" && !p_publish) return { changed: [], left: [] };
  const moving = t.agreement_version_landlords.filter((r) => r.version_id === v.id && !r.removed_at && !r.live).map((r) => r.landlord_id);
  const left = [];
  for (const r of t.agreement_version_landlords) {
    if (r.kind === v.kind && r.live && r.version_id !== v.id && moving.includes(r.landlord_id)) {
      Object.assign(r, { live: false, removed_at: p_now, removed_by_id: p_admin_id });
      if (!left.includes(r.version_id)) left.push(r.version_id);
    }
  }
  for (const id of left) {
    const other = t.agreement_versions.find((x) => x.id === id);
    if (other?.status === "live" && !t.agreement_version_landlords.some((r) => r.version_id === id && !r.removed_at)) other.status = "retired";
  }
  if (p_publish) Object.assign(v, { status: "live", requires_resign: false, published_at: p_now, published_by_id: p_admin_id });
  await unique(db.from("agreement_version_landlords").update({ live: true }).eq("version_id", v.id).is("removed_at", null).eq("live", false));
  return { changed: [...moving, ...removed], left };
}

const RPC = { agreement_version_set_landlords: setLandlordsFn };

const DEFAULT_TEMPLATE = (id) => ({
  id,
  recipients: [{ id: 11, role: "SIGNER" }],
  fields: [
    { id: 1, type: "SIGNATURE", recipientId: 11 },
    { id: 2, type: "TEXT", recipientId: 11, page: 7, height: 75, fieldMeta: { label: "Exhibit A" } },
  ],
});

// A fake Documenso: one template, copies made from it, and their state. Copies
// are prepared as drafts and opened by finishSigningCopy, like the real client.
export function fakeDocumenso() {
  const envelopes = new Map();
  const calls = { copies: 0, cancelled: [], downloads: 0, lastCopy: null, copiesMade: [], fills: [], lastFill: null };
  let n = 0;
  const draft = (input, items) => {
    calls.copies += 1;
    calls.lastCopy = input;
    calls.copiesMade.push(input);
    const id = `envelope_${++n}`;
    // The copy carries the template's boxes (with new ids, like Documenso).
    const template = input.templateId ? envelopes.get(input.templateId) ?? DEFAULT_TEMPLATE(input.templateId) : null;
    // Prefilled values land in the copy's boxes as text, as Documenso does.
    const filled = new Map((input.prefill ?? []).filter((p) => p?.id && p.value != null && String(p.value).trim()).map((p) => [p.id, String(p.value)]));
    const fields = (template?.fields ?? []).map((f, i) => {
      // Like Documenso: a copy's boxes get new ids and lose their labels.
      const copy = { ...structuredClone(f), id: n * 1000 + i, recipientId: 1 };
      if (copy.fieldMeta) delete copy.fieldMeta.label;
      if (filled.has(f.id)) copy.fieldMeta = { ...(copy.fieldMeta ?? {}), text: filled.get(f.id) };
      return copy;
    });
    envelopes.set(id, {
      id,
      status: "DRAFT",
      envelopeItems: items(n),
      fields,
      recipients: [{ id: 1, role: "SIGNER", name: input.name, email: input.email, token: null, signedAt: null }],
    });
    return id;
  };
  return {
    calls,
    envelopes,
    async prepareSigningCopy(input) {
      const id = draft(input, (k) => [{ id: `item_${k}`, order: 1 }, ...(input.exhibit ? [{ id: `item_${k}_exhibit`, order: 2 }] : [])]);
      return { envelopeId: id, exhibitItemId: input.exhibit ? `item_${n}_exhibit` : null };
    },
    async finishSigningCopy({ envelopeId, fill = [] }) {
      const e = envelopes.get(envelopeId);
      const wanted = fill.filter((f) => f?.id && f.value != null);
      calls.fills.push({ envelopeId, fill: wanted });
      calls.lastFill = wanted;
      for (const f of wanted) {
        const field = e.fields.find((x) => x.id === f.id);
        if (field) field.fieldMeta = { ...(field.fieldMeta ?? {}), text: String(f.value), readOnly: true };
      }
      e.status = "PENDING";
      const k = envelopeId.split("_")[1];
      e.recipients[0].token = `token_${k}`;
      return { token: `token_${k}` };
    },
    async createSigningCopy(input) {
      const prepared = await this.prepareSigningCopy(input);
      const { token } = await this.finishSigningCopy({ envelopeId: prepared.envelopeId });
      return { ...prepared, token };
    },
    async discard(id) {
      calls.cancelled.push(id);
      envelopes.get(id).status = "CANCELLED";
    },
    async getEnvelope(id) {
      // A template nobody set up: a signer, a Signature box and an "Exhibit A" box.
      if (!envelopes.has(id) && !/^envelope_\d+$/.test(id)) return structuredClone(DEFAULT_TEMPLATE(id));
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
    async downloadSignedItems(envelope) {
      calls.downloads += 1;
      return envelope.envelopeItems.map((item) => ({ id: item.id, order: item.order, bytes: new Uint8Array([37, 80, 68, 70, 45, item.order]) }));
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


// A live custom version for these landlords (agreement_versions + agreement_version_landlords).
export function addCustomVersion(db, version, landlordIds) {
  const v = { status: "live", kind: "master", ...version, audience: "selected" };
  db.tables.agreement_versions ??= [];
  db.tables.agreement_versions.push(v);
  db.tables.agreement_version_landlords ??= [];
  for (const id of landlordIds) {
    db.tables.agreement_version_landlords.push({ id: `avl-${v.id}-${id}`, version_id: v.id, landlord_id: id, kind: v.kind, live: v.status === "live", removed_at: null, added_at: "2026-11-01T00:00:00.000Z" });
  }
  return v;
}
