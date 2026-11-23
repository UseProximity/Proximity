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
 *
 * Only a change a student would act on is posted (Wyatt, 2026-11-23): a
 * website saying the same thing in new words ("7 days a week" read again as
 * "seven days a week") is not. A change in any amount, time or date always
 * counts; with the same numbers, a quick model check decides.
 */
import supabase from "@/lib/supabase";
import { postProxyMessage, PROXY_USER_ID } from "./threads";
import { notifyStudentThread } from "./notify";
import { z } from "zod";
import { parseStructured, HAIKU } from "./model";

const WINDOW_DAYS = 30;

const WORD_NUMBERS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, hundred: 100 };
export const numbersOf = (text) => [...new Set(String(text ?? "").toLowerCase()
  .replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|hundred)\b/g, (w) => String(WORD_NUMBERS[w]))
  .replace(/(\d),(\d{3})\b/g, "$1$2")
  .match(/\d+(?:\.\d+)?/g) ?? [])].map((n) => String(Number(n))).sort().join(",");

const Verdict = z.object({ material: z.boolean() });
const CHECK = `A student was earlier told one thing about a rental listing. The listing's knowledge now says something else. Decide whether the student needs to be told.

material = true when something they could act on changed: an amount, a date or time, whether something is allowed, included, required or available, a new restriction or condition, or the old statement is now wrong.
material = false when it is the same information in other words, or only adds or drops detail that changes nothing they were told.`;

// Exported for the test harness.
export async function isMaterialChange({ listingId = null, oldSummary, summary, failOpen = false }) {
  if (!oldSummary) return true;
  if (numbersOf(oldSummary) !== numbersOf(summary)) return true;
  try {
    const { parsed } = await parseStructured({
      model: HAIKU, system: CHECK, schema: Verdict, maxTokens: 100, tag: "correction_check", listingId, kind: "correction_check",
      messages: [{ role: "user", content: `Told before: ${oldSummary}\nNow: ${summary}` }],
    });
    if (typeof parsed?.material === "boolean") return parsed.material;
    console.error("[agents] correction check gave no answer");
    return failOpen;
  } catch (err) {
    // Unsure: a website read stays quiet (a missed rewording note costs
    // nothing), a landlord's own words still go out (failOpen), so a real
    // correction is never lost to an API outage (PR 475 review).
    console.error("[agents] correction check failed:", err?.message ?? err);
    return failOpen;
  }
}

export async function postCorrections({ listingId, changes, failOpen = true }) {
  const list = (changes ?? []).filter((c) => c.key && c.summary);
  if (!list.length) return 0;
  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  let posted = 0;
  for (const c of list) {
    const { data: msgs } = await supabase.from("chat_messages").select("thread_id")
      .eq("listing_id", listingId).eq("sender_id", PROXY_USER_ID).eq("message_type", "proxy_answer")
      .contains("metadata", { factKeys: [c.key] }).gte("created_at", since).is("deleted_at", null).limit(500);
    const threads = [...new Set((msgs ?? []).map((m) => m.thread_id))];
    if (!threads.length) continue;
    if (!(await isMaterialChange({ listingId, oldSummary: c.oldSummary, summary: c.summary, failOpen }))) continue;
    for (const threadId of threads) {
      // Once per thread per change.
      const { data: already } = await supabase.from("chat_messages").select("id").eq("thread_id", threadId)
        .eq("message_type", "proxy_note").contains("metadata", { correction: c.key, summary: c.summary }).limit(1);
      if (already?.length) continue;
      await postProxyMessage({ threadId, listingId, type: "proxy_note", body: `Quick update from the landlord: ${c.summary}`, metadata: { correction: c.key, summary: c.summary } });
      posted++;
      const { data: todays } = await supabase.from("sent_emails").select("id").eq("thread_id", threadId)
        .in("kind", ["proxy_answer", "proxy_relay", "proxy_clarifier", "proxy_correction", "proxy_no_answer"]).gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()).limit(1);
      if (!todays?.length) await notifyStudentThread({ threadId, kind: "proxy_correction", quietMs: 0 }).catch(() => {});
    }
  }
  return posted;
}
