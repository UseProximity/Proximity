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
  // One live standard version per kind, one live negotiated version per kind per landlord.
  agreement_versions: [(r) => (r.status === "live" ? `live:${r.kind ?? "master"}:${r.landlord_id ?? "standard"}` : null)],
  agreement_amendments: [(r) => (r.status === "sent" ? `pending:${r.user_id}` : null)],
  agreement_coverage: [(r) => (r.status !== "released" ? `${r.agreement_id}:${r.listing_id}` : null)],
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
  return { tables, from: query };
}

// A fake Documenso: one template, copies made from it, and their state.
export function fakeDocumenso() {
  const envelopes = new Map();
  const calls = { copies: 0, cancelled: [], downloads: 0, lastCopy: null, copiesMade: [] };
  let n = 0;
  return {
    calls,
    envelopes,
    async createSigningCopy(input) {
      calls.copies += 1;
      calls.lastCopy = input;
      calls.copiesMade.push(input);
      const id = `envelope_${++n}`;
      envelopes.set(id, {
        id,
        status: "PENDING",
        envelopeItems: [{ id: `item_${n}`, order: 1 }, ...(input.exhibit ? [{ id: `item_${n}_exhibit`, order: 2 }] : [])],
        recipients: [{ id: 1, role: "SIGNER", name: input.name, email: input.email, token: `token_${n}`, signedAt: null }],
      });
      return { envelopeId: id, token: `token_${n}`, exhibitItemId: input.exhibit ? `item_${n}_exhibit` : null };
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

