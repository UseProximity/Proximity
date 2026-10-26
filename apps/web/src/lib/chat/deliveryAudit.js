/*
 * Daily chat email audit (Wyatt, 2026-10-23).
 *
 * Proves, for every message written since the last check-in, that the other
 * side was told about it, and lists anything that was not. Run by the daily
 * check-in (api/cron/chat-checkin) and added to its email.
 *
 * Three questions, each over the window since the previous successful run:
 *
 *   1. Did every message reach the other person? Yes when an alert email was
 *      logged to them in that conversation after the message (one alert covers
 *      the whole run of unread messages), or they read it in the app. If not,
 *      the reason: they turned message emails off, their address is
 *      suppressed, the send failed, or no alert was recorded at all.
 *   2. Did every alert email arrive? SES reports delivery per email
 *      (api/ses/events). Anything that bounced, was marked as spam, was
 *      refused, failed, is still delayed, or has heard nothing back after
 *      UNCONFIRMED_AFTER_MS is listed. Gmail fallback sends cannot be
 *      confirmed and are listed too.
 *   3. Did every emailed reply get posted? Every inbound email that was not
 *      posted is listed, including spam and automatic replies, in case a
 *      real reply was misread.
 *
 * "Delivered" means the recipient's mail server accepted the email. Nobody can
 * see whether it then went to the inbox or the spam folder; a recipient who
 * never opens the app after several delivered alerts is the signal for that,
 * and the check-in's "waiting on a reply" section already lists them.
 */
import { fetchAll, loadConversations } from "@/lib/chat/checkin";

// A message younger than this may still be inside its 30 second alert wait.
export const AUDIT_SETTLE_MS = 10 * 60 * 1000;
// SES normally reports delivery within seconds; give slow servers two hours.
export const UNCONFIRMED_AFTER_MS = 2 * 60 * 60 * 1000;
const MAX_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Start of the audit window: the last successful real check-in, at most 7 days back. */
export async function auditWindowStart(supabase, now = new Date()) {
  const { data } = await supabase
    .from("chat_checkin_runs")
    .select("started_at")
    .eq("kind", "checkin")
    .eq("ok", true)
    .eq("dry_run", false)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const floor = now.getTime() - MAX_WINDOW_MS;
  const last = data?.started_at ? Date.parse(data.started_at) : now.getTime() - DEFAULT_WINDOW_MS;
  // Back off by the settle time, so a message that was too new last run is checked now.
  return new Date(Math.max(floor, last - AUDIT_SETTLE_MS));
}

/**
 * Pure: which messages did not reach the other side, and why.
 *
 * @param {object} input
 * @param {Array} input.messages   [{ id, thread_id, sender_id, created_at }]
 * @param {Map}   input.recipientOf message id -> the other side's user id
 * @param {Array} input.log        chat_email_log rows for these threads
 * @param {Map}   input.lastReadAt "thread|user" -> last_read_at
 * @param {Map}   input.userById   user id -> { email_notifications, suppressed }
 */
export function findUnalertedMessages({ messages, recipientOf, log, lastReadAt, userById }) {
  const out = [];
  for (const m of messages) {
    const to = recipientOf.get(m.id);
    if (!to) continue;
    const at = Date.parse(m.created_at);
    const after = log.filter(
      (l) => l.thread_id === m.thread_id && l.recipient_id === to && Date.parse(l.created_at) >= at
    );
    if (after.some((l) => l.status !== "failed")) continue;
    const read = lastReadAt.get(`${m.thread_id}|${to}`);
    if (read && Date.parse(read) >= at) continue;

    const u = userById.get(to);
    let reason = "no_alert";
    if (after.length > 0) reason = "send_failed";
    else if (u && u.email_notifications !== true) reason = "emails_off";
    else if (u?.suppressed) reason = "suppressed";
    out.push({ messageId: m.id, threadId: m.thread_id, recipientId: to, createdAt: m.created_at, reason });
  }
  return out;
}

/** Pure: alert emails that have not been confirmed delivered. */
export function findUndeliveredEmails(log, now = new Date()) {
  return log.filter((l) => {
    if (l.status === "delivered") return false;
    if (l.status !== "sent") return true;
    if (l.provider !== "ses") return true;
    return now.getTime() - Date.parse(l.created_at) > UNCONFIRMED_AFTER_MS;
  });
}

export async function auditChatDelivery(supabase, { now = new Date(), since } = {}) {
  const start = since ?? (await auditWindowStart(supabase, now));
  const settled = new Date(now.getTime() - AUDIT_SETTLE_MS);

  const messages = await fetchAll(
    supabase
      .from("chat_messages")
      .select("id, thread_id, sender_id, created_at")
      .is("deleted_at", null)
      .not("sender_id", "is", null)
      .gte("created_at", start.toISOString())
      .lt("created_at", settled.toISOString())
      .order("created_at", { ascending: true })
  );

  const threadIds = [...new Set(messages.map((m) => m.thread_id))];
  const conversations = await loadConversations(supabase, { threadIds });
  const byThread = new Map(conversations.map((c) => [c.thread.id, c]));

  const recipientOf = new Map();
  const people = new Set();
  const counted = [];
  for (const m of messages) {
    const c = byThread.get(m.thread_id);
    if (!c) continue;
    const to = m.sender_id === c.landlord.id ? c.student.id : m.sender_id === c.student.id ? c.landlord.id : null;
    if (!to) continue;
    recipientOf.set(m.id, to);
    people.add(to);
    counted.push(m);
  }

  // Alerts sent since the window opened (they cover messages in it), plus the
  // older ones whose delivery is still being checked.
  const logSince = new Date(start.getTime() - UNCONFIRMED_AFTER_MS);
  const [log, participants, users, suppressions, inbound] = await Promise.all([
    fetchAll(
      supabase
        .from("chat_email_log")
        .select("id, thread_id, recipient_id, to_email, provider, kind, message_id, status, status_detail, created_at")
        .gte("created_at", logSince.toISOString())
        .order("created_at", { ascending: true })
    ),
    threadIds.length
      ? fetchAll(supabase.from("chat_participants").select("thread_id, user_id, last_read_at").in("thread_id", threadIds))
      : [],
    people.size
      ? fetchAll(supabase.from("users").select("id, email, email_notifications").in("id", [...people]))
      : [],
    fetchAll(supabase.from("email_suppressions").select("email")),
    fetchAll(
      supabase
        .from("chat_inbound_emails")
        .select("id, from_email, thread_id, status, reason, created_at")
        .gte("created_at", start.toISOString())
        .not("status", "in", "(posted,duplicate)")
        .order("created_at", { ascending: true })
    ),
  ]);

  const suppressed = new Set(suppressions.map((s) => s.email));
  const userById = new Map(
    users.map((u) => [u.id, { ...u, suppressed: suppressed.has(String(u.email ?? "").trim().toLowerCase()) }])
  );
  const lastReadAt = new Map(participants.map((p) => [`${p.thread_id}|${p.user_id}`, p.last_read_at]));

  const unalerted = findUnalertedMessages({ messages: counted, recipientOf, log, lastReadAt, userById }).map((u) => {
    const c = byThread.get(u.threadId);
    const recipient = u.recipientId === c.landlord.id ? c.landlord : c.student;
    return { ...u, recipient, listing: c.listing, subject: c.thread.subject };
  });

  const windowLog = log.filter((l) => Date.parse(l.created_at) >= start.getTime());
  const undelivered = findUndeliveredEmails(
    log.filter((l) => Date.parse(l.created_at) >= logSince.getTime() && Date.parse(l.created_at) < now.getTime()),
    now
  );

  return {
    since: start.toISOString(),
    until: settled.toISOString(),
    stats: {
      messages: counted.length,
      emailsSent: windowLog.filter((l) => l.status !== "failed").length,
      emailsDelivered: windowLog.filter((l) => l.status === "delivered").length,
      unalerted: unalerted.length,
      undelivered: undelivered.length,
      inboundNotPosted: inbound.length,
    },
    unalerted,
    undelivered,
    inbound,
  };
}

/** True when the audit found anything a person should look at. */
export function auditHasProblems(audit) {
  if (!audit) return false;
  // Someone who turned emails off chose that; it is listed but is not a problem.
  const real = audit.unalerted.filter((u) => u.reason !== "emails_off");
  return real.length > 0 || audit.undelivered.length > 0 || audit.inbound.length > 0;
}
