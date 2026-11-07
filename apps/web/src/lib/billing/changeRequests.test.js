/*
 * Run with: npm test (from apps/web).
 *
 * Landlords' requests to change the marketing agreement, against an in-memory
 * database: the status rules, opening, replying, withdrawing, the admin answers,
 * resolving on signing, who may open an attachment, the 5 day reminder, and the
 * attachment checks. No database, bucket or email needed.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  acceptRequest,
  attachmentFor,
  createChangeRequest,
  declineRequest,
  listForAdmin,
  listMyRequests,
  nextStatus,
  remindersDue,
  replyAsAdmin,
  replyAsLandlord,
  resolveChangeRequestOnSigned,
  sendChangeRequestReminders,
  withdrawRequest,
} from "./changeRequests.js";
import { changeFileKey, cleanChangeFileName, detectChangeFileType, validateChangeFile } from "./changeRequestFileRules.js";
import { changeRequestTeamEmail, changeRequestUpdateEmail } from "./billingEmailTemplates.js";

// ── An in-memory stand-in for the Supabase calls these paths make ──────────

const UNIQUE = {
  agreement_change_requests: [(r) => (["open", "answered", "accepted"].includes(r.status) ? `active:${r.user_id}` : null)],
};

function fakeDb(tables = {}) {
  let nextId = 1;
  let clock = Date.parse("2026-11-04T12:00:00.000Z");
  const rows = (t) => (tables[t] ??= []);
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
      eq(c, v) { filters.push((r) => r[c] === v); return api; },
      in(c, vs) { filters.push((r) => vs.includes(r[c])); return api; },
      order() { return api; },
      limit() { return api; },
      insert(row) { op = { kind: "insert", row }; return api; },
      update(patch) { op = { kind: "update", patch }; return api; },
      delete() { op = { kind: "delete" }; return api; },
      maybeSingle() { single = "maybe"; return api.run(); },
      single() { single = "one"; return api.run(); },
      then(res, rej) { return api.run().then(res, rej); },
      async run() {
        let data;
        if (op.kind === "insert") {
          const id = `00000000-0000-4000-8000-${String(nextId++).padStart(12, "0")}`;
          const created = new Date((clock += 1000)).toISOString();
          const row = { id, created_at: created, updated_at: created, ...op.row };
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

const LANDLORD = { id: "11111111-1111-4111-8111-111111111111", name: "Lana Landlord", email: "lana@example.com" };
const OTHER = { id: "22222222-2222-4222-8222-222222222222", name: "Other", email: "other@example.com" };
const ADMIN = "33333333-3333-4333-8333-333333333333";

function recorder() {
  const sent = [];
  const notify = {};
  for (const k of ["newRequest", "landlordReplied", "teamReplied", "reminder"]) notify[k] = async (input) => sent.push([k, input]);
  return { sent, notify };
}

const seed = () =>
  fakeDb({
    users: [{ ...LANDLORD }, { ...OTHER }],
    landlord_agreements: [{ id: "agreement-lana", user_id: LANDLORD.id }],
    agreement_versions: [{ id: "v-standard", landlord_id: null }],
  });

const open = (db, extra = {}) =>
  createChangeRequest(db, {
    user: LANDLORD,
    documentKind: "master",
    section: "Section 4, fees",
    body: "The fee should be lower for renewals.",
    proposedText: "4.2 The fee for a renewal is half the fee.",
    versionId: "v-standard",
    ...extra,
  });

// ── The rules ───────────────────────────────────────────────────────────────

describe("nextStatus", () => {
  it("moves between waiting on the team and waiting on the landlord", () => {
    assert.equal(nextStatus("open", "admin_reply"), "answered");
    assert.equal(nextStatus("answered", "landlord_reply"), "open");
    assert.equal(nextStatus("open", "landlord_reply"), "open");
    assert.equal(nextStatus("answered", "admin_reply"), "answered");
  });
  it("keeps an accepted request accepted while both sides talk", () => {
    assert.equal(nextStatus("accepted", "landlord_reply"), "accepted");
    assert.equal(nextStatus("accepted", "admin_reply"), "accepted");
  });
  it("accepts, declines, withdraws and resolves only from the right places", () => {
    assert.equal(nextStatus("answered", "accept"), "accepted");
    assert.equal(nextStatus("accepted", "decline"), "declined");
    assert.equal(nextStatus("open", "withdraw"), "withdrawn");
    assert.equal(nextStatus("accepted", "resolve"), "resolved");
    assert.throws(() => nextStatus("open", "resolve"), (e) => e.code === "not_accepted");
    assert.throws(() => nextStatus("accepted", "accept"), (e) => e.code === "already_accepted");
    for (const closed of ["resolved", "declined", "withdrawn"]) {
      for (const action of ["landlord_reply", "admin_reply", "accept", "decline", "withdraw"]) {
        assert.throws(() => nextStatus(closed, action), (e) => e.code === "request_closed", `${closed} ${action}`);
      }
    }
  });
});

// ── Landlord side ───────────────────────────────────────────────────────────

describe("opening a request", () => {
  it("records the request and its first message, and tells the team", async () => {
    const db = seed();
    const { sent, notify } = recorder();
    const view = await open(db, { notify });
    assert.equal(view.status, "open");
    assert.equal(view.section, "Section 4, fees");
    assert.equal(view.messages.length, 1);
    assert.equal(view.messages[0].authorRole, "landlord");
    assert.equal(view.messages[0].proposedText, "4.2 The fee for a renewal is half the fee.");
    assert.deepEqual(sent.map(([k]) => k), ["newRequest"]);
  });

  it("allows one request in progress per landlord", async () => {
    const db = seed();
    await open(db);
    await assert.rejects(() => open(db), (e) => e.code === "already_open" && e.status === 409);
    // Another landlord is unaffected.
    await createChangeRequest(db, { user: OTHER, body: "Please change clause 2." });
  });

  it("needs a message, and refuses a document that is not theirs", async () => {
    const db = seed();
    await assert.rejects(() => open(db, { body: "   " }), (e) => e.code === "body_required");
    await assert.rejects(() => open(db, { documentKind: "lease" }), (e) => e.code === "bad_kind");
    await assert.rejects(
      () => createChangeRequest(db, { user: OTHER, body: "x", agreementId: "agreement-lana" }),
      (e) => e.code === "bad_document"
    );
    db.tables.agreement_versions.push({ id: "v-other", landlord_id: OTHER.id });
    await assert.rejects(() => open(db, { versionId: "v-other" }), (e) => e.code === "bad_document");
    assert.equal(db.tables.agreement_change_requests?.length ?? 0, 0);
  });

  it("stores an attachment under the landlord and keeps the key off the view", async () => {
    const db = seed();
    const stored = [];
    const storeFile = async ({ userId, name }) => {
      stored.push(userId);
      return { key: `billing/agreement-change-requests/${userId}/f.pdf`, fileName: name, fileType: "application/pdf", fileBytes: 10 };
    };
    const view = await open(db, { file: { bytes: new Uint8Array(10), name: "markup.pdf" }, storeFile });
    assert.deepEqual(stored, [LANDLORD.id]);
    assert.deepEqual(view.messages[0].file, { name: "markup.pdf", type: "application/pdf", bytes: 10 });
    assert.equal(JSON.stringify(view).includes("billing/agreement-change-requests"), false);
  });

  it("a rejected file leaves no request behind", async () => {
    const db = seed();
    const storeFile = async () => {
      throw Object.assign(new Error("bad"), { code: "bad_file_type" });
    };
    await assert.rejects(() => open(db, { file: { bytes: new Uint8Array(3), name: "x.exe" }, storeFile }));
    assert.equal(db.tables.agreement_change_requests?.length ?? 0, 0);
  });

  it("an email failure never fails the request", async () => {
    const db = seed();
    const view = await open(db, { notify: { newRequest: async () => { throw new Error("smtp down"); } } });
    assert.equal(view.status, "open");
  });
});

describe("the thread", () => {
  it("goes back and forth, and only the owner can reply or withdraw", async () => {
    const db = seed();
    const { sent, notify } = recorder();
    const { id } = await open(db);
    assert.equal((await replyAsAdmin(db, { adminId: ADMIN, requestId: id, body: "Which renewals?", notify })).status, "answered");
    assert.equal((await replyAsLandlord(db, { user: LANDLORD, requestId: id, body: "All of them.", notify })).status, "open");
    await assert.rejects(() => replyAsLandlord(db, { user: OTHER, requestId: id, body: "hi" }), (e) => e.status === 404);
    await assert.rejects(() => withdrawRequest(db, { user: OTHER, requestId: id }), (e) => e.status === 404);
    assert.deepEqual(sent.map(([k, input]) => [k, input.outcome ?? null]), [["teamReplied", "replied"], ["landlordReplied", null]]);

    const [mine] = await listMyRequests(db, LANDLORD.id);
    assert.deepEqual(mine.messages.map((m) => m.authorRole), ["landlord", "admin", "landlord"]);

    assert.equal((await withdrawRequest(db, { user: LANDLORD, requestId: id })).status, "withdrawn");
    await assert.rejects(() => replyAsLandlord(db, { user: LANDLORD, requestId: id, body: "again" }), (e) => e.code === "request_closed");
    // Closed, so a new one can be opened.
    await open(db);
  });

  it("decline needs a note, closes the request and emails the landlord", async () => {
    const db = seed();
    const { sent, notify } = recorder();
    const { id } = await open(db);
    await assert.rejects(() => declineRequest(db, { adminId: ADMIN, requestId: id, note: " " }), (e) => e.code === "note_required");
    const declined = await declineRequest(db, { adminId: ADMIN, requestId: id, note: "The fee is the same for everyone.", notify });
    assert.equal(declined.status, "declined");
    assert.equal(declined.closed_by_id, ADMIN);
    assert.equal(sent[0][1].outcome, "declined");
    assert.equal(sent[0][1].landlord.email, LANDLORD.email);
  });

  it("refuses an action on a request that changed meanwhile", async () => {
    const db = seed();
    const { id } = await open(db);
    await acceptRequest(db, { adminId: ADMIN, requestId: id });
    await assert.rejects(() => acceptRequest(db, { adminId: ADMIN, requestId: id }), (e) => e.code === "already_accepted");
  });
});

// ── Accept, then resolve on signing ─────────────────────────────────────────

describe("an accepted request", () => {
  it("is resolved when the landlord signs the version made for it, and only then", async () => {
    const db = seed();
    const { sent, notify } = recorder();
    const { id } = await open(db);
    const accepted = await acceptRequest(db, { adminId: ADMIN, requestId: id, note: "Agreed, a version is coming.", notify });
    assert.equal(accepted.status, "accepted");
    assert.equal(sent[0][1].outcome, "accepted");

    db.tables.agreement_versions.push({ id: "v-lana", landlord_id: LANDLORD.id, change_request_id: id });
    // Signing the standard version does not resolve it.
    assert.equal(await resolveChangeRequestOnSigned(db, { userId: LANDLORD.id, versionId: "v-standard" }), "unchanged");
    // Another landlord signing something cannot resolve it.
    assert.equal(await resolveChangeRequestOnSigned(db, { userId: OTHER.id, versionId: "v-lana" }), "unchanged");
    assert.equal(await resolveChangeRequestOnSigned(db, { userId: LANDLORD.id, versionId: "v-lana" }), "resolved");
    const row = db.tables.agreement_change_requests[0];
    assert.equal(row.status, "resolved");
    assert.equal(row.resolution_version_id, "v-lana");
    // Running it again changes nothing.
    assert.equal(await resolveChangeRequestOnSigned(db, { userId: LANDLORD.id, versionId: "v-lana" }), "unchanged");
    assert.equal(await resolveChangeRequestOnSigned(db, { userId: LANDLORD.id, versionId: null }), "unchanged");
  });
});

// ── Attachments ─────────────────────────────────────────────────────────────

describe("who may open an attachment", () => {
  it("the landlord whose request it is, or an admin", async () => {
    const db = seed();
    const storeFile = async ({ userId }) => ({ key: `k/${userId}`, fileName: "m.pdf", fileType: "application/pdf", fileBytes: 5 });
    await open(db, { file: { bytes: new Uint8Array(5), name: "m.pdf" }, storeFile });
    const messageId = db.tables.agreement_change_messages[0].id;
    assert.deepEqual(await attachmentFor(db, { messageId, viewerId: LANDLORD.id }), { key: `k/${LANDLORD.id}`, fileName: "m.pdf" });
    assert.equal((await attachmentFor(db, { messageId, isAdmin: true })).fileName, "m.pdf");
    await assert.rejects(() => attachmentFor(db, { messageId, viewerId: OTHER.id }), (e) => e.status === 404);
  });
});

describe("attachment checks", () => {
  const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);
  const docx = new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...Buffer.from("[Content_Types].xml word/document.xml")]);
  const doc = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0]);

  it("knows a file by its bytes, not its name", () => {
    assert.equal(detectChangeFileType(pdf, "anything.docx"), "pdf");
    assert.equal(detectChangeFileType(docx, "markup.docx"), "docx");
    assert.equal(detectChangeFileType(doc, "markup.doc"), "doc");
    assert.equal(detectChangeFileType(docx, "archive.zip"), null);
    assert.equal(detectChangeFileType(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2]), "fake.docx"), null);
    assert.equal(detectChangeFileType(new Uint8Array([1, 2, 3]), "x.pdf"), null);
  });

  it("refuses empty, oversized and other files", () => {
    assert.throws(() => validateChangeFile({ bytes: new Uint8Array(0), name: "a.pdf" }), (e) => e.code === "empty_file");
    const big = new Uint8Array(4 * 1024 * 1024 + 1);
    big.set(pdf);
    assert.throws(() => validateChangeFile({ bytes: big, name: "a.pdf" }), (e) => e.code === "file_too_large");
    assert.throws(() => validateChangeFile({ bytes: new Uint8Array([77, 90, 0, 0]), name: "run.exe" }), (e) => e.code === "bad_file_type");
    assert.deepEqual(validateChangeFile({ bytes: pdf, name: "My markup (v2).pdf" }), {
      ext: "pdf",
      contentType: "application/pdf",
      fileName: "My markup -v2.pdf",
      size: pdf.length,
    });
  });

  it("cleans names and builds keys only from ids", () => {
    assert.equal(cleanChangeFileName("../../etc/passwd", "pdf"), "passwd.pdf");
    assert.equal(cleanChangeFileName('evil"name\r\n.docx', "docx"), "evil-name.docx");
    assert.equal(cleanChangeFileName("", "doc"), "attachment.doc");
    assert.equal(
      changeFileKey(LANDLORD.id, "44444444-4444-4444-8444-444444444444", "pdf"),
      `billing/agreement-change-requests/${LANDLORD.id}/44444444-4444-4444-8444-444444444444.pdf`
    );
    assert.throws(() => changeFileKey("../x", "44444444-4444-4444-8444-444444444444", "pdf"), (e) => e.code === "bad_key");
    assert.throws(() => changeFileKey(LANDLORD.id, "44444444-4444-4444-8444-444444444444", "exe"), (e) => e.code === "bad_key");
  });
});

// ── The reminder ────────────────────────────────────────────────────────────

describe("the 5 day reminder", () => {
  const day = 24 * 60 * 60 * 1000;
  const now = new Date("2026-11-20T12:00:00.000Z");
  const ago = (d) => new Date(now.getTime() - d * day).toISOString();

  it("is due for open requests unanswered for 5 days, once every 5 days", () => {
    const req = (id, status, created, alert = null) => ({ id, status, created_at: created, last_team_alert_at: alert });
    const msgs = new Map([
      ["a", [{ created_at: ago(6) }]],
      ["b", [{ created_at: ago(10) }, { created_at: ago(2) }]],
      ["c", [{ created_at: ago(9) }]],
      ["d", [{ created_at: ago(9) }]],
      ["e", [{ created_at: ago(20) }]],
    ]);
    const due = remindersDue(
      [
        req("a", "open", ago(6)),
        req("b", "open", ago(10)), // the landlord wrote 2 days ago
        req("c", "answered", ago(9)), // waiting on the landlord
        req("d", "open", ago(9), ago(3)), // reminded 3 days ago
        req("e", "open", ago(20), ago(6)), // reminded 6 days ago
      ],
      msgs,
      now
    );
    assert.deepEqual(due.map((r) => r.id), ["a", "e"]);
  });

  it("sends one email for all of them and stamps them", async () => {
    const db = seed();
    const { sent, notify } = recorder();
    const { id } = await open(db);
    const later = new Date(Date.parse(db.tables.agreement_change_messages[0].created_at) + 6 * day);
    assert.deepEqual(await sendChangeRequestReminders(db, { notify, now: later }), { reminded: 1 });
    assert.equal(sent.length, 1);
    assert.equal(sent[0][1].requests[0].landlord.email, LANDLORD.email);
    assert.equal(db.tables.agreement_change_requests.find((r) => r.id === id).last_team_alert_at, later.toISOString());
    // Not again the next day.
    assert.deepEqual(await sendChangeRequestReminders(db, { notify, now: new Date(later.getTime() + day) }), { reminded: 0 });
  });
});

// ── Admin list and emails ───────────────────────────────────────────────────

describe("admin list", () => {
  it("lists requests with the landlord and counts what is waiting", async () => {
    const db = seed();
    const { id } = await open(db);
    await createChangeRequest(db, { user: OTHER, body: "Clause 2 please." });
    await replyAsAdmin(db, { adminId: ADMIN, requestId: id, body: "Looking." });
    const { requests, counts } = await listForAdmin(db);
    assert.deepEqual(counts, { open: 1, answered: 1, accepted: 0 });
    assert.equal(requests.find((r) => r.id === id).landlord.email, LANDLORD.email);
  });
});

describe("change request emails", () => {
  it("escape what the landlord wrote and never mention internal ids", () => {
    const team = changeRequestTeamEmail({
      landlordName: "<b>Lana</b>",
      landlordEmail: "lana@example.com",
      documentKind: "master",
      section: "4 & 5",
      body: "<script>x</script>",
      proposedText: null,
      hasFile: true,
      isReply: false,
      adminUrl: "https://example.com/dashboard/admin",
    });
    assert.ok(!team.html.includes("<script>"));
    assert.ok(team.html.includes("&lt;b&gt;Lana&lt;/b&gt;"));
    assert.ok(team.html.includes("attached a file"));
    const update = changeRequestUpdateEmail({ name: "Lana", outcome: "declined", message: "No.", paymentsUrl: "https://example.com/p" });
    assert.match(update.html, /standard agreement/);
  });
});
