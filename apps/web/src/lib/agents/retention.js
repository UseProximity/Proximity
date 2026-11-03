/*
 * What account deletion and the retention clock do to the agents' records
 * (Privacy Policy s8 and s9, Wyatt 2026-11-02). Called by the purge-accounts
 * cron.
 *
 *   30 days after deletion (purgeAgentData)
 *     student_availability   the weekly pattern a student offers for tours:
 *                            deleted.
 *     tour_requests          kept, like messages, but the contact copies on
 *                            the row (student_contact, landlord_contact,
 *                            student_phone) are cleared.
 *     Proxy conversations, questions, tours: kept for three years, like any
 *     other conversation.
 *
 *   Three years after deletion (eraseAgentRecords)
 *     Proxy conversations    the account's Proxy threads: messages deleted,
 *                            thread closed and emptied.
 *     tours                  the account's tour requests as the student are
 *                            deleted; as the landlord, their link is removed.
 *     questions              what the account said about a question (waiting
 *                            for it, replies, the question log) is deleted.
 *                            The question itself and the landlord's answer
 *                            stay: they carry no student details and are part
 *                            of the listing's knowledge.
 *
 *   Signed-out Proxy conversations (expireVisitorProxyThreads)
 *     A visitor's Proxy chat that no account claimed and that has had no
 *     message for 90 days is emptied: messages deleted, the confirmed email
 *     and device cookie cleared, and the question log blanked (the row stays
 *     so the listing's question counts hold).
 *
 * Every step throws on failure, so the caller retries the whole account.
 */
import supabase from "@/lib/supabase";

const DAY_MS = 24 * 60 * 60 * 1000;
export const VISITOR_PROXY_RETENTION_DAYS = 90;

async function must(label, query) {
  const { data, error } = await query;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data;
}

let _proxyType = null;
async function proxyTypeId() {
  if (_proxyType) return _proxyType;
  const data = await must("proxy thread type", supabase.from("thread_types").select("id").eq("name", "proxy").maybeSingle());
  _proxyType = data?.id ?? null;
  return _proxyType;
}

/* Empty a set of Proxy threads: messages, waiting questions, saved state. */
async function emptyProxyThreads(ids, label) {
  if (!ids.length) return 0;
  await must(`${label} waiters`, supabase.from("listing_question_waiters").delete().in("thread_id", ids));
  await must(`${label} question replies`, supabase.from("listing_question_messages").update({ body: "", raw_body: null }).in("thread_id", ids).eq("sender", "student"));
  await must(`${label} question log`, supabase.from("listing_agent_questions").update({ question: "", answer: null, visitor_id: null }).in("thread_id", ids));
  await must(`${label} messages`, supabase.from("chat_messages").delete().in("thread_id", ids));
  await must(`${label} threads`, supabase.from("chat_threads").update({
    deleted_at: new Date().toISOString(), visitor_id: null, notify_email: null, proxy_state: {},
  }).in("id", ids));
  return ids.length;
}

export async function purgeAgentData(userId) {
  await must("student_availability", supabase.from("student_availability").delete().eq("user_id", userId));
  await must("tour contacts as student", supabase.from("tour_requests").update({ student_contact: null, student_phone: null }).eq("student_id", userId));
  await must("tour contacts as landlord", supabase.from("tour_requests").update({ landlord_contact: null }).eq("landlord_id", userId));
}

export async function eraseAgentRecords(userId) {
  const typeId = await proxyTypeId();
  if (typeId) {
    const threads = await must("retained proxy threads", supabase.from("chat_threads").select("id")
      .eq("thread_type_id", typeId).eq("interested_user_id", userId));
    await emptyProxyThreads((threads ?? []).map((t) => t.id), "retained proxy");
  }
  await must("retained tours as student", supabase.from("tour_requests").delete().eq("student_id", userId));
  await must("retained tours as landlord", supabase.from("tour_requests").update({ landlord_id: null, landlord_contact: null }).eq("landlord_id", userId));
  await must("retained question waiters", supabase.from("listing_question_waiters").delete().eq("user_id", userId));
  await must("retained question replies", supabase.from("listing_question_messages").delete().eq("user_id", userId).eq("sender", "student"));
  await must("retained question log", supabase.from("listing_agent_questions").delete().eq("user_id", userId));
}

export async function expireVisitorProxyThreads({ now = Date.now(), limit = 500 } = {}) {
  const typeId = await proxyTypeId();
  if (!typeId) return 0;
  const cutoff = new Date(now - VISITOR_PROXY_RETENTION_DAYS * DAY_MS).toISOString();
  const stale = await must("visitor proxy threads", supabase.from("chat_threads").select("id")
    .eq("thread_type_id", typeId).is("interested_user_id", null).not("visitor_id", "is", null)
    .lt("created_at", cutoff).is("deleted_at", null).limit(limit));
  const ids = (stale ?? []).map((t) => t.id);
  if (!ids.length) return 0;
  // Quiet means no message since the cutoff (updated_at moves on any change).
  const recent = await must("visitor proxy recent messages", supabase.from("chat_messages").select("thread_id")
    .in("thread_id", ids).gte("created_at", cutoff));
  const active = new Set((recent ?? []).map((m) => m.thread_id));
  return emptyProxyThreads(ids.filter((id) => !active.has(id)), "visitor proxy");
}
