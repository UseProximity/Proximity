/*
 * Landlords asking for changes to the commission agreement (agreement_change_requests
 * and agreement_change_messages). Documenso has no redlining, so the conversation
 * happens here and Documenso only ever sees the version that is finally signed.
 *
 * A request is about the master agreement or an Exhibit A amendment, before or
 * after signing. One active request (open, answered or accepted) per landlord;
 * everything after the first message is a follow-up in the same thread.
 *
 *   open      waiting on the team (new, or the landlord replied)
 *   answered  the team replied; waiting on the landlord
 *   accepted  the team agreed. An admin uploads a version for this landlord only
 *             (agreement_versions.landlord_id, change_request_id) and makes it live.
 *   resolved  the landlord signed that version (resolveChangeRequestOnSigned)
 *   declined  the team said no. The landlord can sign the standard agreement or ask again.
 *   withdrawn the landlord closed it
 *
 * A request never blocks signing the standard agreement and never touches a
 * signing copy in progress: it only records the conversation.
 *
 * `db` is a service-role Supabase client. Files are stored through
 * `storeFile({ userId, bytes, name })` (changeRequestFiles.storeChangeFile) and
 * emails sent through `notify` (changeRequestNotify.js), both passed in so this
 * stays testable. A failed email never fails the action.
 */
import { BillingError } from "./errors.js";
import { DAY_MS } from "./constants.js";
import { declineBody, isDeclineMessage } from "./declineNote.js";

export const ACTIVE_STATUSES = ["open", "answered", "accepted"];
export const CLOSED_STATUSES = ["resolved", "declined", "withdrawn"];
export const DOCUMENT_KINDS = ["master", "amendment"];
export const SECTION_MAX = 200;
export const BODY_MAX = 10000;
export const REMINDER_DAYS = 5;

const UNIQUE_VIOLATION = "23505";
const REQUEST_COLUMNS =
  "id, user_id, document_kind, agreement_id, amendment_id, version_id, section, status, resolution_version_id, closed_at, closed_by_id, last_team_alert_at, created_at, updated_at";
const MESSAGE_COLUMNS =
  "id, request_id, author_id, author_role, body, proposed_text, file_key, file_name, file_type, file_bytes, created_at";

// ── The rules ───────────────────────────────────────────────────────────────

/*
 * What an action does to a request's status. Returns the new status, or throws
 * when the action is not allowed from where the request stands.
 *   landlord: reply, withdraw        admin: reply, accept, decline
 *   system:   resolve (the landlord signed the negotiated version)
 */
export function nextStatus(current, action) {
  const closed = () => new BillingError("request_closed", "This request is closed. Start a new one if you need to.", 409);
  switch (action) {
    case "landlord_reply":
      if (current === "open" || current === "answered") return "open";
      if (current === "accepted") return "accepted";
      throw closed();
    case "admin_reply":
      if (current === "open" || current === "answered") return "answered";
      if (current === "accepted") return "accepted";
      throw closed();
    case "accept":
      if (current === "open" || current === "answered") return "accepted";
      if (current === "accepted") throw new BillingError("already_accepted", "This request is already accepted.", 409);
      throw closed();
    case "decline":
    case "withdraw":
      if (ACTIVE_STATUSES.includes(current)) return action === "decline" ? "declined" : "withdrawn";
      throw closed();
    case "resolve":
      if (current === "accepted") return "resolved";
      throw new BillingError("not_accepted", "Only an accepted request can be resolved.", 409);
    default:
      throw new BillingError("bad_action", "Unknown action.");
  }
}

const text = (v) => String(v ?? "").replace(/\r\n/g, "\n").trim();

// One message's text: `body` is required, `proposedText` (their wording) optional.
export function cleanMessage({ body, proposedText }) {
  const b = text(body);
  const p = text(proposedText);
  if (!b) throw new BillingError("body_required", "Write what you would like changed and why.");
  if (b.length > BODY_MAX) throw new BillingError("body_too_long", `Keep your message under ${BODY_MAX} characters.`);
  if (p.length > BODY_MAX) throw new BillingError("proposed_too_long", `Keep the proposed wording under ${BODY_MAX} characters.`);
  return { body: b, proposed_text: p || null };
}

export function cleanRequest({ documentKind, section, ...message }) {
  const kind = documentKind ?? "master";
  if (!DOCUMENT_KINDS.includes(kind)) throw new BillingError("bad_kind", "Choose the agreement or an Exhibit A amendment.");
  const s = text(section);
  if (s.length > SECTION_MAX) throw new BillingError("section_too_long", `Keep the section under ${SECTION_MAX} characters.`);
  return { document_kind: kind, section: s || null, ...cleanMessage(message) };
}

// When the latest message landed: how long a request has been waiting.
export const lastActivityAt = (request, messages) =>
  messages.reduce((t, m) => (m.created_at > t ? m.created_at : t), request.created_at);

/*
 * Open requests the team has not answered for REMINDER_DAYS, and has not been
 * reminded about in the last REMINDER_DAYS. `messagesByRequest` maps request id to
 * its messages.
 */
export function remindersDue(requests, messagesByRequest, now = new Date()) {
  const gap = REMINDER_DAYS * DAY_MS;
  return requests.filter((r) => {
    if (r.status !== "open") return false;
    const waiting = now.getTime() - new Date(lastActivityAt(r, messagesByRequest.get(r.id) ?? [])).getTime();
    const sinceAlert = r.last_team_alert_at ? now.getTime() - new Date(r.last_team_alert_at).getTime() : Infinity;
    return waiting >= gap && sinceAlert >= gap;
  });
}

// What a landlord or an admin sees. Storage keys never leave the server.
export function messageView(m) {
  return {
    id: m.id,
    authorRole: m.author_role,
    body: m.body,
    proposedText: m.proposed_text,
    file: m.file_key ? { name: m.file_name, type: m.file_type, bytes: m.file_bytes } : null,
    createdAt: m.created_at,
  };
}

export function requestView(r, messages = [], extra = {}) {
  const sorted = [...messages].sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));
  return {
    id: r.id,
    status: r.status,
    documentKind: r.document_kind,
    agreementId: r.agreement_id,
    amendmentId: r.amendment_id,
    versionId: r.version_id,
    section: r.section,
    resolutionVersionId: r.resolution_version_id,
    createdAt: r.created_at,
    closedAt: r.closed_at,
    lastActivityAt: lastActivityAt(r, sorted),
    messages: sorted.map(messageView),
    ...extra,
  };
}

// ── Reading ─────────────────────────────────────────────────────────────────

async function messagesFor(db, requestIds) {
  if (!requestIds.length) return new Map();
  const { data, error } = await db
    .from("agreement_change_messages")
    .select(MESSAGE_COLUMNS)
    .in("request_id", requestIds)
    .order("created_at", { ascending: true });
  if (error) throw error;
  const map = new Map(requestIds.map((id) => [id, []]));
  for (const m of data ?? []) map.get(m.request_id)?.push(m);
  return map;
}

async function loadRequest(db, requestId) {
  const { data, error } = await db.from("agreement_change_requests").select(REQUEST_COLUMNS).eq("id", requestId).maybeSingle();
  if (error) throw error;
  if (!data) throw new BillingError("not_found", "That change request was not found.", 404);
  return data;
}

// The landlord's own requests, newest first, with their threads.
export async function listMyRequests(db, userId) {
  const { data, error } = await db
    .from("agreement_change_requests")
    .select(REQUEST_COLUMNS)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw error;
  const rows = (data ?? []).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  const messages = await messagesFor(db, rows.map((r) => r.id));
  return rows.map((r) => requestView(r, messages.get(r.id)));
}

async function landlordOf(db, userId) {
  const { data, error } = await db.from("users").select("id, name, email").eq("id", userId).maybeSingle();
  if (error) throw error;
  return data;
}

/*
 * For the admin list: every request (optionally one status), with the landlord and
 * the thread, plus counts by status. `waiting` (open) is the badge count.
 */
export async function listForAdmin(db, { status = null } = {}) {
  let q = db.from("agreement_change_requests").select(REQUEST_COLUMNS).order("updated_at", { ascending: false }).limit(200);
  if (status) q = q.eq("status", status);
  const { data, error } = await q;
  if (error) throw error;
  const rows = data ?? [];
  const [messages, landlords, counts] = await Promise.all([
    messagesFor(db, rows.map((r) => r.id)),
    (async () => {
      const ids = [...new Set(rows.map((r) => r.user_id))];
      if (!ids.length) return new Map();
      const { data: users, error: uErr } = await db.from("users").select("id, name, email, company_name").in("id", ids);
      if (uErr) throw uErr;
      return new Map((users ?? []).map((u) => [u.id, u]));
    })(),
    countByStatus(db),
  ]);
  const requests = rows.map((r) => {
    const u = landlords.get(r.user_id);
    return requestView(r, messages.get(r.id), {
      landlord: { id: r.user_id, name: u?.name ?? null, email: u?.email ?? null, company: u?.company_name ?? null },
    });
  });
  return { requests, counts };
}

export async function countByStatus(db) {
  const { data, error } = await db.from("agreement_change_requests").select("status").in("status", ACTIVE_STATUSES);
  if (error) throw error;
  const counts = { open: 0, answered: 0, accepted: 0 };
  for (const r of data ?? []) counts[r.status] += 1;
  return counts;
}

// ── Landlord actions ────────────────────────────────────────────────────────

async function storeAttachment(file, userId, storeFile) {
  if (!file) return {};
  if (!storeFile) throw new BillingError("files_unavailable", "Attachments are not available right now.", 503);
  const stored = await storeFile({ userId, bytes: file.bytes, name: file.name });
  return { file_key: stored.key, file_name: stored.fileName, file_type: stored.fileType, file_bytes: stored.fileBytes };
}

// The document the landlord is asking about must be theirs (or the standard one).
async function checkTargets(db, userId, { agreementId, amendmentId, versionId }) {
  const owned = async (table, id, column = "user_id") => {
    if (!id) return;
    const { data, error } = await db.from(table).select(`id, ${column}`).eq("id", id).maybeSingle();
    if (error) throw error;
    const owner = data?.[column];
    if (!data || (column === "landlord_id" ? owner && owner !== userId : owner !== userId)) {
      throw new BillingError("bad_document", "That document was not found.", 404);
    }
  };
  await owned("landlord_agreements", agreementId);
  await owned("agreement_amendments", amendmentId);
  await owned("agreement_versions", versionId, "landlord_id");
}

async function safely(fn) {
  if (!fn) return;
  try {
    await fn();
  } catch (err) {
    console.error("billing: change request email failed", err?.message);
  }
}

/*
 * A new request. `user` is { id, name, email }; `file` optional { bytes, name }.
 * The file is stored first, so a rejected file never leaves an empty request.
 */
export async function createChangeRequest(
  db,
  { user, documentKind, agreementId = null, amendmentId = null, versionId = null, section, body, proposedText, file = null, storeFile, notify = {} }
) {
  const clean = cleanRequest({ documentKind, section, body, proposedText });
  await checkTargets(db, user.id, { agreementId, amendmentId, versionId });
  const attachment = await storeAttachment(file, user.id, storeFile);

  const { data: request, error } = await db
    .from("agreement_change_requests")
    .insert({
      user_id: user.id,
      document_kind: clean.document_kind,
      agreement_id: agreementId,
      amendment_id: amendmentId,
      version_id: versionId,
      section: clean.section,
      status: "open",
    })
    .select(REQUEST_COLUMNS)
    .single();
  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      throw new BillingError("already_open", "You already have a change request in progress. Add to it below instead.", 409);
    }
    throw error;
  }

  const { data: message, error: mErr } = await db
    .from("agreement_change_messages")
    .insert({ request_id: request.id, author_id: user.id, author_role: "landlord", body: clean.body, proposed_text: clean.proposed_text, ...attachment })
    .select(MESSAGE_COLUMNS)
    .single();
  if (mErr) {
    // Never leave a request with no message in it.
    await db.from("agreement_change_requests").delete().eq("id", request.id);
    throw mErr;
  }

  await safely(notify.newRequest && (() => notify.newRequest({ landlord: user, request, message })));
  return requestView(request, [message]);
}

async function ownRequest(db, userId, requestId) {
  const request = await loadRequest(db, requestId);
  if (request.user_id !== userId) throw new BillingError("not_found", "That change request was not found.", 404);
  return request;
}

/*
 * Move a request to `status`, only if it is still where we read it (a conditional
 * update), so two admins, or an admin and the landlord, cannot overwrite each other.
 */
async function moveTo(db, request, status, extra = {}) {
  const { data, error } = await db
    .from("agreement_change_requests")
    .update({ status, ...extra })
    .eq("id", request.id)
    .eq("status", request.status)
    .select(REQUEST_COLUMNS)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new BillingError("status_changed", "This request was just updated. Refresh and try again.", 409);
  return data;
}

async function addMessage(db, request, { authorId, role, body, proposedText = null, attachment = {} }) {
  const clean = cleanMessage({ body, proposedText });
  const { data, error } = await db
    .from("agreement_change_messages")
    .insert({ request_id: request.id, author_id: authorId, author_role: role, ...clean, ...attachment })
    .select(MESSAGE_COLUMNS)
    .single();
  if (error) throw error;
  return data;
}

export async function replyAsLandlord(db, { user, requestId, body, proposedText, file = null, storeFile, notify = {} }) {
  const request = await ownRequest(db, user.id, requestId);
  const status = nextStatus(request.status, "landlord_reply");
  cleanMessage({ body, proposedText });
  const attachment = await storeAttachment(file, user.id, storeFile);
  const updated = await moveTo(db, request, status);
  const message = await addMessage(db, updated, { authorId: user.id, role: "landlord", body, proposedText, attachment });
  await safely(notify.landlordReplied && (() => notify.landlordReplied({ landlord: user, request: updated, message })));
  return updated;
}

export async function withdrawRequest(db, { user, requestId, now = new Date() }) {
  const request = await ownRequest(db, user.id, requestId);
  const status = nextStatus(request.status, "withdraw");
  return moveTo(db, request, status, { closed_at: now.toISOString(), closed_by_id: user.id });
}

// ── A rejection in Documenso becomes a change request ───────────────────────

async function activeRequestOf(db, userId) {
  const { data, error } = await db
    .from("agreement_change_requests")
    .select(REQUEST_COLUMNS)
    .eq("user_id", userId)
    .in("status", ACTIVE_STATUSES)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/*
 * Called once when a landlord rejects a signing copy in Documenso. The reason they
 * typed there opens a change request for them, or, when they already have one in
 * progress, is added to it (one active request per landlord). Emails nothing: the
 * caller sends the one team email about the decline. Returns { request, message,
 * opened } (opened false when it was added to an existing request).
 *
 * `doc` names what was rejected: { kind, agreementId, amendmentId, versionId }.
 */
export async function recordDecline(db, { userId, doc, reason }) {
  const body = declineBody(reason);
  const append = async (request) => {
    const updated = request.status === "answered" ? await moveTo(db, request, nextStatus(request.status, "landlord_reply")) : request;
    const message = await addMessage(db, updated, { authorId: userId, role: "landlord", body });
    return { request: updated, message, opened: false };
  };

  const existing = await activeRequestOf(db, userId);
  if (existing) return append(existing);

  const { data: request, error } = await db
    .from("agreement_change_requests")
    .insert({
      user_id: userId,
      document_kind: DOCUMENT_KINDS.includes(doc.kind) ? doc.kind : "master",
      agreement_id: doc.agreementId ?? null,
      amendment_id: doc.amendmentId ?? null,
      version_id: doc.versionId ?? null,
      section: null,
      status: "open",
    })
    .select(REQUEST_COLUMNS)
    .single();
  if (error) {
    // One appeared in between (the landlord opened one at the same moment).
    if (error.code === UNIQUE_VIOLATION) {
      const raced = await activeRequestOf(db, userId);
      if (raced) return append(raced);
    }
    throw error;
  }
  const { data: message, error: mErr } = await db
    .from("agreement_change_messages")
    .insert({ request_id: request.id, author_id: userId, author_role: "landlord", body, proposed_text: null })
    .select(MESSAGE_COLUMNS)
    .single();
  if (mErr) {
    await db.from("agreement_change_requests").delete().eq("id", request.id);
    throw mErr;
  }
  return { request, message, opened: true };
}

/*
 * Right after rejecting, the signing window asks the landlord for the details: the
 * reason (prefilled, editable), section, proposed wording and a file. These fill in
 * the decline message itself rather than repeating it, while it is still the newest
 * message on the request. If someone has written since, they go in as a normal reply.
 */
export async function completeDecline(db, { user, requestId, section, body, proposedText, file = null, storeFile, notify = {} }) {
  const request = await ownRequest(db, user.id, requestId);
  if (!ACTIVE_STATUSES.includes(request.status)) nextStatus(request.status, "landlord_reply"); // throws "closed"
  const clean = cleanRequest({ documentKind: request.document_kind, section, body, proposedText });

  const { data: msgs, error } = await db
    .from("agreement_change_messages")
    .select(MESSAGE_COLUMNS)
    .eq("request_id", request.id)
    .order("created_at", { ascending: true });
  if (error) throw error;
  const latest = (msgs ?? []).reduce((a, m) => (!a || m.created_at > a.created_at ? m : a), null);
  if (!latest || !isDeclineMessage(latest) || latest.author_id !== user.id) {
    return replyAsLandlord(db, { user, requestId, body, proposedText, file, storeFile, notify });
  }

  const attachment = await storeAttachment(file, user.id, storeFile);
  const { data: message, error: mErr } = await db
    .from("agreement_change_messages")
    .update({ body: declineBody(clean.body), proposed_text: clean.proposed_text, ...attachment })
    .eq("id", latest.id)
    .select(MESSAGE_COLUMNS)
    .maybeSingle();
  if (mErr) throw mErr;

  // A section only for a request that has none, so it never rewrites an earlier one.
  let updated = request;
  if (clean.section && !request.section) {
    const { data, error: sErr } = await db
      .from("agreement_change_requests")
      .update({ section: clean.section })
      .eq("id", request.id)
      .select(REQUEST_COLUMNS)
      .maybeSingle();
    if (sErr) throw sErr;
    if (data) updated = data;
  }
  await safely(notify.landlordReplied && (() => notify.landlordReplied({ landlord: user, request: updated, message: message ?? latest })));
  return updated;
}

// ── Admin actions ───────────────────────────────────────────────────────────

export async function replyAsAdmin(db, { adminId, requestId, body, file = null, storeFile, notify = {} }) {
  const request = await loadRequest(db, requestId);
  const status = nextStatus(request.status, "admin_reply");
  cleanMessage({ body });
  const attachment = await storeAttachment(file, request.user_id, storeFile);
  const updated = await moveTo(db, request, status);
  const message = await addMessage(db, updated, { authorId: adminId, role: "admin", body, attachment });
  const landlord = await landlordOf(db, request.user_id);
  await safely(notify.teamReplied && (() => notify.teamReplied({ landlord, request: updated, message, outcome: "replied" })));
  return updated;
}

// Declining needs a note for the landlord: it is posted in the thread and emailed.
export async function declineRequest(db, { adminId, requestId, note, notify = {}, now = new Date() }) {
  const request = await loadRequest(db, requestId);
  const status = nextStatus(request.status, "decline");
  if (!text(note)) throw new BillingError("note_required", "Write a note for the landlord saying why.");
  cleanMessage({ body: note });
  const updated = await moveTo(db, request, status, { closed_at: now.toISOString(), closed_by_id: adminId });
  const message = await addMessage(db, updated, { authorId: adminId, role: "admin", body: note });
  const landlord = await landlordOf(db, request.user_id);
  await safely(notify.teamReplied && (() => notify.teamReplied({ landlord, request: updated, message, outcome: "declined" })));
  return updated;
}

/*
 * Accepting records the decision. The negotiated document itself is uploaded as a
 * version for this landlord (POST /api/admin/billing/agreement-versions with
 * landlordId and changeRequestId), then connected, checked and made live there.
 */
export async function acceptRequest(db, { adminId, requestId, note = null, notify = {} }) {
  const request = await loadRequest(db, requestId);
  const status = nextStatus(request.status, "accept");
  const updated = await moveTo(db, request, status);
  const message = text(note) ? await addMessage(db, updated, { authorId: adminId, role: "admin", body: note }) : null;
  const landlord = await landlordOf(db, request.user_id);
  await safely(notify.teamReplied && (() => notify.teamReplied({ landlord, request: updated, message, outcome: "accepted" })));
  return updated;
}

/*
 * Called when a landlord signs a version: if that version was made for their
 * accepted change request, the request is resolved. Returns "resolved" or
 * "unchanged". Never throws for a request that is not there.
 */
export async function resolveChangeRequestOnSigned(db, { userId, versionId, now = new Date() }) {
  if (!versionId) return "unchanged";
  const { data: version, error } = await db
    .from("agreement_versions")
    .select("id, landlord_id, change_request_id")
    .eq("id", versionId)
    .maybeSingle();
  if (error) throw error;
  if (!version?.change_request_id || (version.landlord_id && version.landlord_id !== userId)) return "unchanged";
  const { data, error: uErr } = await db
    .from("agreement_change_requests")
    .update({ status: "resolved", resolution_version_id: version.id, closed_at: now.toISOString() })
    .eq("id", version.change_request_id)
    .eq("user_id", userId)
    .eq("status", "accepted")
    .select("id")
    .maybeSingle();
  if (uErr) throw uErr;
  return data ? "resolved" : "unchanged";
}

/*
 * The attachment on one message, if the viewer may open it: the landlord the
 * request belongs to, or an admin. Returns { key, fileName }.
 */
export async function attachmentFor(db, { messageId, viewerId, isAdmin = false }) {
  const { data: message, error } = await db
    .from("agreement_change_messages")
    .select("id, request_id, file_key, file_name")
    .eq("id", messageId)
    .maybeSingle();
  if (error) throw error;
  if (!message?.file_key) throw new BillingError("not_found", "That file was not found.", 404);
  if (!isAdmin) {
    const request = await loadRequest(db, message.request_id);
    if (request.user_id !== viewerId) throw new BillingError("not_found", "That file was not found.", 404);
  }
  return { key: message.file_key, fileName: message.file_name };
}

// ── The daily reminder ──────────────────────────────────────────────────────

/*
 * Tell the team about requests that have waited REMINDER_DAYS without an answer,
 * in one email, then stamp them so the next reminder is REMINDER_DAYS later.
 * Run from the daily billing cron. Returns how many were included.
 */
export async function sendChangeRequestReminders(db, { notify = {}, now = new Date() } = {}) {
  const { data, error } = await db.from("agreement_change_requests").select(REQUEST_COLUMNS).eq("status", "open");
  if (error) throw error;
  const open = data ?? [];
  if (!open.length) return { reminded: 0 };
  const messages = await messagesFor(db, open.map((r) => r.id));
  const due = remindersDue(open, messages, now);
  if (!due.length || !notify.reminder) return { reminded: 0 };

  const users = new Map();
  for (const id of new Set(due.map((r) => r.user_id))) users.set(id, await landlordOf(db, id));
  await safely(() =>
    notify.reminder({
      requests: due.map((r) => ({
        landlord: users.get(r.user_id),
        section: r.section,
        documentKind: r.document_kind,
        waitingSince: lastActivityAt(r, messages.get(r.id) ?? []),
      })),
    })
  );
  const { error: stampError } = await db
    .from("agreement_change_requests")
    .update({ last_team_alert_at: now.toISOString() })
    .in("id", due.map((r) => r.id))
    .eq("status", "open");
  if (stampError) throw stampError;
  return { reminded: due.length };
}
