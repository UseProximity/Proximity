/*
 * Emails Proxy sends (PRD v3).
 *
 *   notifyStudentThread        a student who has left the page gets an email
 *                              when Proxy answers or relays a landlord's
 *                              answer. Same 30-second wait as chat alerts,
 *                              so a burst of messages becomes one email, and
 *                              nothing is sent if they read the thread in the
 *                              meantime. A signed-out visitor is emailed only
 *                              if they left an address on the thread.
 *   notifyLandlordQuestion     a landlord gets one email per new question,
 *                              with the context line and a link to their
 *                              queue. Never the student's name.
 *   notifyLandlordStudentReply the student answered a clarifying question.
 *   remindLandlord             day 1 and day 3 reminders (cron).
 *   tellStudentNoAnswer        day 5: Proxy tells the student there is no
 *                              answer yet (cron).
 *
 * Every send goes through lib/email.js, so off production it is redirected
 * or suppressed like every other email.
 */
import supabase from "@/lib/supabase";
import { getBaseUrl, sendProxyStudentEmail, sendProxyLandlordQuestionEmail } from "@/lib/email";
import { ALERT_QUIET_MS } from "@/lib/chat/notifyEmail";
import { PROXY_USER_ID, postProxyMessage } from "./threads";
import { questionReplyAddress } from "./questionTokens";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function threadRecipient(threadId) {
  const { data: t } = await supabase.from("chat_threads")
    .select("id, listing_id, interested_user_id, visitor_id, notify_email, listings!listing_id(title, address)")
    .eq("id", threadId).maybeSingle();
  if (!t) return null;
  let email = null;
  let name = null;
  let userId = t.interested_user_id;
  if (userId) {
    const { data: u } = await supabase.from("users").select("email, name, email_notifications, deleted_at").eq("id", userId).maybeSingle();
    if (u && !u.deleted_at && u.email_notifications !== false) { email = u.email; name = u.name; }
  } else if (t.notify_email) {
    email = t.notify_email;
  }
  return { thread: t, email, name, userId, listingLabel: t.listings?.title || t.listings?.address || "a listing" };
}

export async function notifyStudentThread({ threadId, kind = "proxy_answer", quietMs = ALERT_QUIET_MS }) {
  try {
    const at = new Date();
    if (quietMs > 0) await sleep(quietMs);
    const r = await threadRecipient(threadId);
    if (!r?.email) return "no_recipient";
    if (r.userId) {
      const { data: p } = await supabase.from("chat_participants").select("last_read_at").eq("thread_id", threadId).eq("user_id", r.userId).maybeSingle();
      if (p?.last_read_at && new Date(p.last_read_at) >= at) return "read";
    }
    const { data: msgs } = await supabase.from("chat_messages").select("body, message_type, created_at").eq("thread_id", threadId)
      .eq("sender_id", PROXY_USER_ID).is("deleted_at", null).gte("created_at", new Date(at.getTime() - 60_000).toISOString())
      .order("created_at", { ascending: true }).limit(5);
    if (!msgs?.length) return "nothing";
    await sendProxyStudentEmail({
      to: r.email, name: r.name, kind, listingLabel: r.listingLabel,
      messages: msgs.map((m) => m.body),
      threadUrl: `${getBaseUrl()}/listings/${r.thread.listing_id}?listingTab=contact`,
      threadId, userId: r.userId ?? null,
    });
    return "sent";
  } catch (err) {
    console.error("[proxy] student email failed:", err?.message ?? err);
    return "failed";
  }
}

async function questionWithOwner(questionId) {
  const { data: q } = await supabase.from("listing_questions")
    .select("id, listing_id, owner_id, question, context, asked_count, created_at, reminder_1_at, reminder_3_at, listings!listing_id(title, address)")
    .eq("id", questionId).maybeSingle();
  if (!q?.owner_id) return null;
  const { data: u } = await supabase.from("users").select("id, email, name, email_notifications, deleted_at, password_hash, google_account").eq("id", q.owner_id).maybeSingle();
  if (!u?.email || u.deleted_at || u.email_notifications === false) return null;
  const hasAccount = !!(u.password_hash || u.google_account);
  return { q, owner: u, hasAccount, listingLabel: q.listings?.title || q.listings?.address || "your listing" };
}

// Every landlord email about a question can be answered by replying to it.
const replyTo = (r) => questionReplyAddress({ questionId: r.q.id, ownerId: r.q.owner_id });

export async function notifyLandlordQuestion({ questionId }) {
  const r = await questionWithOwner(questionId);
  if (!r) return "no_recipient";
  await sendProxyLandlordQuestionEmail({
    to: r.owner.email, name: r.owner.name, listingLabel: r.listingLabel, question: r.q.question, context: r.q.context,
    kind: "proxy_question", hasAccount: r.hasAccount, replyTo: replyTo(r),
    queueUrl: `${getBaseUrl()}/dashboard/landlord?tab=questions`,
  });
  return "sent";
}

export async function notifyLandlordStudentReply({ questionId }) {
  const r = await questionWithOwner(questionId);
  if (!r) return "no_recipient";
  const { data: last } = await supabase.from("listing_question_messages").select("body").eq("question_id", questionId).eq("sender", "student")
    .order("created_at", { ascending: false }).limit(1);
  await sendProxyLandlordQuestionEmail({
    to: r.owner.email, name: r.owner.name, listingLabel: r.listingLabel, question: r.q.question, context: r.q.context,
    kind: "proxy_question", hasAccount: r.hasAccount, studentReply: last?.[0]?.body ?? null, replyTo: replyTo(r),
    queueUrl: `${getBaseUrl()}/dashboard/landlord?tab=questions`,
  });
  return "sent";
}

export async function remindLandlord({ questionId, day }) {
  const r = await questionWithOwner(questionId);
  if (!r) return "no_recipient";
  await sendProxyLandlordQuestionEmail({
    to: r.owner.email, name: r.owner.name, listingLabel: r.listingLabel, question: r.q.question, context: r.q.context,
    kind: "proxy_reminder", hasAccount: r.hasAccount, reminderDay: day, replyTo: replyTo(r),
    queueUrl: `${getBaseUrl()}/dashboard/landlord?tab=questions`,
  });
  return "sent";
}

/* Day 5: every thread waiting on the question hears there is no answer yet. */
export async function tellStudentsNoAnswer({ questionId }) {
  const { data: q } = await supabase.from("listing_questions").select("id, listing_id, question").eq("id", questionId).maybeSingle();
  if (!q) return 0;
  const { data: waiters } = await supabase.from("listing_question_waiters").select("thread_id").eq("question_id", questionId);
  let n = 0;
  for (const w of waiters ?? []) {
    await postProxyMessage({
      threadId: w.thread_id, listingId: q.listing_id, type: "proxy_note",
      body: `The landlord hasn't answered "${q.question}" yet. I'll post it here if they do. If you're still interested, you can ask to book a tour, or browse similar places on Proximity.`,
      metadata: { questionId: q.id, noAnswer: true },
    });
    notifyStudentThread({ threadId: w.thread_id, kind: "proxy_no_answer", quietMs: 0 }).catch(() => {});
    n++;
  }
  return n;
}
