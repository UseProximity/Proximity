/*
 * "Students are told when an answer they received is later corrected"
 * (PRD v3, decisions log).
 *
 * When a fact changes, every Proxy thread that was given an answer built on
 * that fact in the last 30 days gets a short update ("Update: parking is now
 * $90 a month"), and the student is emailed, at most one update email per
 * thread per day.
 *
 * Which answers used which facts comes from chat_messages.metadata.factKeys,
 * written with every Proxy answer.
 */
import supabase from "@/lib/supabase";
import { postProxyMessage, PROXY_USER_ID } from "./threads";
import { notifyStudentThread } from "./notify";

const WINDOW_DAYS = 30;

export async function postCorrections({ listingId, changes }) {
  const list = (changes ?? []).filter((c) => c.key && c.summary);
  if (!list.length) return 0;
  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  let posted = 0;
  for (const c of list) {
    const { data: msgs } = await supabase.from("chat_messages").select("thread_id")
      .eq("listing_id", listingId).eq("sender_id", PROXY_USER_ID).eq("message_type", "proxy_answer")
      .contains("metadata", { factKeys: [c.key] }).gte("created_at", since).is("deleted_at", null).limit(500);
    const threads = [...new Set((msgs ?? []).map((m) => m.thread_id))];
    for (const threadId of threads) {
      // Once per thread per change.
      const { data: already } = await supabase.from("chat_messages").select("id").eq("thread_id", threadId)
        .eq("message_type", "proxy_note").contains("metadata", { correction: c.key, summary: c.summary }).limit(1);
      if (already?.length) continue;
      await postProxyMessage({ threadId, listingId, type: "proxy_note", body: `Quick update from the landlord: ${c.summary}`, metadata: { correction: c.key, summary: c.summary } });
      posted++;
      const { data: todays } = await supabase.from("sent_emails").select("id").eq("thread_id", threadId)
        .in("kind", ["proxy_answer", "proxy_relay", "proxy_no_answer"]).gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()).limit(1);
      if (!todays?.length) notifyStudentThread({ threadId, kind: "proxy_answer", quietMs: 0 }).catch(() => {});
    }
  }
  return posted;
}
