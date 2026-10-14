/*
 * Internal chat check-in (Wyatt, 2026-10-13).
 *
 * The team wants to know when a landlord or a student has stopped answering.
 * The daily cron (api/cron/chat-checkin) calls findStaleThreads() and emails
 * the result to the internal recipients, in two sections: landlords who went
 * quiet and students who went quiet. Each entry carries the most recent
 * messages, walked backwards until both people have been heard from (at most
 * two from each side), so the reader can judge the conversation without
 * opening the admin dashboard.
 *
 * "Quiet" means: the newest message in the thread was written by one side,
 * it is at least STALE_AFTER_DAYS old, and the other side has posted nothing
 * since. A thread with no messages at all is not a conversation and is
 * skipped. Messages with no sender (system notices) never count as a reply.
 *
 * Which user is the landlord and which is the student comes from the thread
 * itself (landlord_id, interested_user_id). Older threads without those
 * columns fall back to the participants' roles.
 *
 * Internal email only. These helpers never email a landlord or a student.
 */
import nodemailer from "nodemailer";
import { sendMailSafe } from "@/lib/outreach";

export const STALE_AFTER_DAYS = 3;
// Up to this many messages from each side in an excerpt.
export const EXCERPT_PER_SIDE = 2;
// Hard cap on an excerpt, whatever the sides look like.
export const EXCERPT_MAX = 2 * EXCERPT_PER_SIDE + 2;
// Message bodies are cut here in the email so one essay does not bury the rest.
const BODY_PREVIEW_CHARS = 500;

/*
 * The default recipients were set by Wyatt (2026-10-13). CHAT_CHECKIN_ALERT_EMAILS
 * (comma separated) overrides the list without a deploy. Off production every
 * send goes through sendMailSafe, which redirects or suppresses it.
 */
const DEFAULT_RECIPIENTS = [
  "bflicker@useproximity.org",
  "info@useproximity.org",
  "o.wyatt@wustl.edu",
];

export function resolveCheckinRecipients() {
  const raw = process.env.CHAT_CHECKIN_ALERT_EMAILS;
  if (!raw) return DEFAULT_RECIPIENTS;
  const list = raw.split(",").map((s) => s.trim()).filter((s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s));
  return list.length > 0 ? list : DEFAULT_RECIPIENTS;
}

const PAGE = 1000;

// PostgREST caps a response at 1000 rows whatever the range.
export async function fetchAll(query) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await query.range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return rows;
  }
}

const roleOf = (user) => user?.roles?.name ?? null;

/*
 * Who is on each side of a thread. Returns { landlord, student } as user rows,
 * or null when a side cannot be worked out, in which case the thread is not a
 * landlord and student conversation we can report on.
 */
function sidesOf(thread, participantsByThread, userById) {
  let landlord = thread.landlord_id ? userById.get(thread.landlord_id) : null;
  let student = thread.interested_user_id ? userById.get(thread.interested_user_id) : null;

  if (!landlord || !student) {
    const others = (participantsByThread.get(thread.id) ?? [])
      .map((p) => userById.get(p.user_id))
      .filter(Boolean)
      .filter((u) => u.id !== landlord?.id && u.id !== student?.id);
    if (!landlord) landlord = others.find((u) => roleOf(u) === "landlord") ?? null;
    if (!student) student = others.find((u) => u.id !== landlord?.id && roleOf(u) !== "landlord") ?? null;
  }

  if (!landlord || !student || landlord.id === student.id) return null;
  return { landlord, student };
}

/*
 * The tail of a conversation: newest messages first in the walk, returned
 * oldest first. Stops once each side has EXCERPT_PER_SIDE messages, or at
 * EXCERPT_MAX. A side that never wrote anything cannot be waited for, so when
 * one side has no messages at all the walk stops once the other side is
 * represented.
 */
export function excerptMessages(messages, { landlordId, studentId }) {
  const wrote = { landlord: false, student: false };
  for (const m of messages) {
    if (m.sender_id === landlordId) wrote.landlord = true;
    else if (m.sender_id === studentId) wrote.student = true;
  }
  const want = {
    landlord: wrote.landlord ? EXCERPT_PER_SIDE : 0,
    student: wrote.student ? EXCERPT_PER_SIDE : 0,
  };
  const have = { landlord: 0, student: 0 };
  const picked = [];
  for (let i = messages.length - 1; i >= 0 && picked.length < EXCERPT_MAX; i--) {
    const m = messages[i];
    const side = m.sender_id === landlordId ? "landlord" : m.sender_id === studentId ? "student" : null;
    if (!side) continue;
    if (have[side] >= want[side]) {
      if (have.landlord >= want.landlord && have.student >= want.student) break;
      continue;
    }
    have[side] += 1;
    picked.push({ ...m, side });
    if (have.landlord >= want.landlord && have.student >= want.student) break;
  }
  return picked.reverse();
}

/*
 * Every thread that is a landlord and student conversation, with its people,
 * listing and messages, oldest message first. `threadIds` limits the load;
 * without it every open thread is returned. Threads whose sides cannot be
 * worked out, or whose people are deleted, are left out.
 *
 * Returns [{ thread, listing, landlord, student, messages, allMessages }]
 * where `messages` are the two people's own messages and `allMessages` also
 * includes system notices.
 */
export async function loadConversations(supabase, { threadIds = null, includeDeleted = false } = {}) {
  let q = supabase
    .from("chat_threads")
    .select("id, subject, listing_id, landlord_id, interested_user_id, created_at, updated_at, deleted_at")
    .order("updated_at", { ascending: false });
  if (!includeDeleted) q = q.is("deleted_at", null);
  if (threadIds) {
    if (threadIds.length === 0) return [];
    q = q.in("id", threadIds);
  }
  const threads = await fetchAll(q);
  if (threads.length === 0) return [];

  const ids = threads.map((t) => t.id);
  const [messages, participants] = await Promise.all([
    fetchAll(
      supabase
        .from("chat_messages")
        .select("id, thread_id, sender_id, body, message_type, created_at")
        .in("thread_id", ids)
        .is("deleted_at", null)
        .order("created_at", { ascending: true })
    ),
    fetchAll(supabase.from("chat_participants").select("thread_id, user_id").in("thread_id", ids)),
  ]);

  const userIds = [
    ...new Set([
      ...threads.flatMap((t) => [t.landlord_id, t.interested_user_id]),
      ...participants.map((p) => p.user_id),
    ].filter(Boolean)),
  ];
  const listingIds = [...new Set(threads.map((t) => t.listing_id).filter(Boolean))];

  const [users, listings] = await Promise.all([
    userIds.length
      ? fetchAll(
          supabase
            .from("users")
            .select("id, name, email, company_name, deleted_at, roles!role_id(name)")
            .in("id", userIds)
        )
      : [],
    listingIds.length
      ? fetchAll(supabase.from("listings").select("id, title, address").in("id", listingIds))
      : [],
  ]);

  const userById = new Map(users.map((u) => [u.id, u]));
  const listingById = new Map(listings.map((l) => [l.id, l]));
  const participantsByThread = new Map();
  for (const p of participants) {
    if (!participantsByThread.has(p.thread_id)) participantsByThread.set(p.thread_id, []);
    participantsByThread.get(p.thread_id).push(p);
  }
  const messagesByThread = new Map();
  for (const m of messages) {
    if (!messagesByThread.has(m.thread_id)) messagesByThread.set(m.thread_id, []);
    messagesByThread.get(m.thread_id).push(m);
  }

  const out = [];
  for (const t of threads) {
    const sides = sidesOf(t, participantsByThread, userById);
    if (!sides) continue;
    if (sides.landlord.deleted_at || sides.student.deleted_at) continue;
    const all = messagesByThread.get(t.id) ?? [];
    out.push({
      thread: t,
      listing: listingById.get(t.listing_id) ?? null,
      landlord: publicUser(sides.landlord),
      student: publicUser(sides.student),
      allMessages: all,
      // Only the two people count. A system notice is not a reply.
      messages: all.filter((m) => m.sender_id === sides.landlord.id || m.sender_id === sides.student.id),
    });
  }
  return out;
}

/*
 * Every open thread where one side has been silent for STALE_AFTER_DAYS.
 *
 * Returns [{ threadId, subject, listing, landlord, student, quietSide,
 *            lastMessage, silentSince, silentDays, excerpt, messageCount }]
 * sorted longest silence first. `quietSide` is the side we are waiting on.
 */
export async function findStaleThreads(supabase, { now = new Date(), days = STALE_AFTER_DAYS } = {}) {
  const conversations = await loadConversations(supabase);
  const cutoff = now.getTime() - days * 24 * 60 * 60 * 1000;
  const stale = [];

  for (const c of conversations) {
    const theirs = c.messages;
    if (theirs.length === 0) continue;

    const last = theirs[theirs.length - 1];
    const lastAt = new Date(last.created_at).getTime();
    if (lastAt > cutoff) continue;

    const quietSide = last.sender_id === c.landlord.id ? "student" : "landlord";
    const silentDays = Math.floor((now.getTime() - lastAt) / (24 * 60 * 60 * 1000));

    stale.push({
      threadId: c.thread.id,
      subject: c.thread.subject,
      createdAt: c.thread.created_at,
      listing: c.listing,
      landlord: c.landlord,
      student: c.student,
      quietSide,
      lastMessage: { id: last.id, senderId: last.sender_id, createdAt: last.created_at },
      silentSince: last.created_at,
      silentDays,
      messageCount: theirs.length,
      excerpt: excerptMessages(theirs, { landlordId: c.landlord.id, studentId: c.student.id }).map((m) => ({
        id: m.id,
        side: m.side,
        name: m.side === "landlord" ? c.landlord.name : c.student.name,
        body: m.body,
        messageType: m.message_type,
        createdAt: m.created_at,
      })),
    });
  }

  stale.sort((a, b) => new Date(a.silentSince) - new Date(b.silentSince));
  return stale;
}

function publicUser(u) {
  return { id: u.id, name: u.name ?? "(no name)", email: u.email ?? null, company: u.company_name ?? null };
}

// ---------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: Number(process.env.EMAIL_PORT) || 587,
  secure: false,
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
});

export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export const fmtWhen = (iso) => {
  if (!iso) return "unknown time";
  try {
    return new Date(iso).toLocaleString("en-US", {
      timeZone: "America/Chicago",
      month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
    });
  } catch {
    return String(iso);
  }
};

const preview = (body, type) => {
  const text = String(body ?? "").trim();
  if (!text) return type === "attachment" ? "[attachment]" : "(empty message)";
  const cut = text.length > BODY_PREVIEW_CHARS ? `${text.slice(0, BODY_PREVIEW_CHARS)}...` : text;
  return esc(cut).replace(/\n/g, "<br>");
};

const person = (u, label) =>
  `<strong>${esc(label)}:</strong> ${esc(u.name)}${u.company ? ` (${esc(u.company)})` : ""}${u.email ? ` &middot; <a href="mailto:${esc(u.email)}" style="color:#0A0A0A">${esc(u.email)}</a>` : ""}`;

export function wrapHtml(inner) {
  return `
      <div style="font-family:Inter,sans-serif;max-width:620px;margin:0 auto;color:#111">
        <div style="color:#E82027;font-weight:800;letter-spacing:.08em;font-size:14px;margin:18px 0">PROXIMITY</div>
        ${inner}
        <p style="color:#999;font-size:12px;line-height:1.5;margin-top:28px;padding-top:16px;border-top:1px solid #e5e7eb">
          Internal message for the Proximity team. Not sent to any landlord or student.
        </p>
      </div>`;
}

export function sectionHtml(heading, inner, color = "#0A0A0A") {
  if (!inner) return "";
  return `<h3 style="color:${color};font-size:15px;margin:22px 0 4px">${esc(heading)}</h3>${inner}`;
}

function staleCard(item, baseUrl) {
  const where = item.listing
    ? `${esc(item.listing.title ?? "")}${item.listing.address ? ` &middot; ${esc(item.listing.address)}` : ""}`
    : esc(item.subject ?? "(no listing)");
  const waitingOn = item.quietSide === "landlord" ? item.landlord : item.student;
  const bubbles = item.excerpt
    .map((m) => {
      const isQuiet = m.side === item.quietSide;
      return `
        <div style="margin:8px 0;padding:8px 10px;border-radius:10px;background:${isQuiet ? "#f3f4f6" : "#fef2f2"}">
          <div style="font-size:12px;color:#6b7280">${esc(m.name)} (${m.side}) &middot; ${esc(fmtWhen(m.createdAt))}</div>
          <div style="font-size:13px;color:#111;margin-top:2px">${preview(m.body, m.messageType)}</div>
        </div>`;
    })
    .join("");

  return `
  <div style="border:1px solid #e5e7eb;border-radius:12px;padding:14px 16px;margin:10px 0">
    <div style="font-weight:700;color:#0A0A0A">${where}</div>
    <div style="color:#E82027;font-weight:700;font-size:13px;margin-top:4px">
      Waiting on ${esc(waitingOn.name)} for ${item.silentDays} day${item.silentDays === 1 ? "" : "s"} (since ${esc(fmtWhen(item.silentSince))})
    </div>
    <div style="color:#4b5563;font-size:13px;margin-top:6px">${person(item.student, "Student")}</div>
    <div style="color:#4b5563;font-size:13px;margin-top:2px">${person(item.landlord, "Landlord")}</div>
    <div style="color:#6b7280;font-size:12px;margin-top:2px">${item.messageCount} message${item.messageCount === 1 ? "" : "s"} in the thread &middot; thread ${esc(item.threadId.slice(0, 8))}</div>
    ${bubbles}
    <a href="${esc(baseUrl)}/dashboard/admin" style="display:inline-block;margin-top:8px;font-size:13px;color:#0A0A0A">Open the admin dashboard, Conversations view</a>
  </div>`;
}

/*
 * One digest for the whole run. Callers skip the send when `items` is empty.
 */
export function renderCheckinDigest({ items, baseUrl, dryRun = false }) {
  const landlordsQuiet = items.filter((i) => i.quietSide === "landlord");
  const studentsQuiet = items.filter((i) => i.quietSide === "student");

  const inner = `
    <h2 style="color:#111;font-size:18px;margin:0 0 6px">${dryRun ? "[DRY RUN] " : ""}Conversations waiting on a reply</h2>
    <p style="color:#4b5563;font-size:14px;margin:0">
      ${items.length} thread${items.length === 1 ? "" : "s"} where one side has not answered in ${STALE_AFTER_DAYS} days:
      ${landlordsQuiet.length} waiting on a landlord, ${studentsQuiet.length} waiting on a student.
      Each thread is sent once per silence.
    </p>
    ${sectionHtml(`Landlords who went quiet (${landlordsQuiet.length})`, landlordsQuiet.map((i) => staleCard(i, baseUrl)).join(""), "#E82027")}
    ${sectionHtml(`Students who went quiet (${studentsQuiet.length})`, studentsQuiet.map((i) => staleCard(i, baseUrl)).join(""))}
  `;

  return {
    subject: `${dryRun ? "[DRY RUN] " : ""}Chat check-in: ${landlordsQuiet.length} landlord${landlordsQuiet.length === 1 ? "" : "s"} and ${studentsQuiet.length} student${studentsQuiet.length === 1 ? "" : "s"} waiting on a reply`,
    html: wrapHtml(inner),
  };
}

export async function sendCheckinDigestEmail({ to, items, baseUrl, dryRun = false }) {
  const { subject, html } = renderCheckinDigest({ items, baseUrl, dryRun });
  return sendMailSafe(transporter, {
    from: `"Proximity" <${process.env.EMAIL_USER}>`,
    to,
    replyTo: "info@useproximity.org",
    subject,
    html,
  });
}

export { transporter as checkinTransporter };
