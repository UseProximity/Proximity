/*
 * Where a thread's chat alert emails go for one participant, for admin views.
 *
 * Uses fn_chat_alert_email, the same function the alert sender calls, so admin
 * shows the real destination: the lease's confirmed contact, else the
 * listing's, else the account email. An admin page that showed the account
 * email instead made it look like the landlord got mail that actually went to
 * a leasing inbox (Wyatt, 2026-11-16).
 */

const BATCH = 20;
const PAGE = 200;

/**
 * @param {object} supabase  a service client for the chosen database
 * @param {Array<{threadId: string, userId: string}>} pairs
 * @returns {Promise<Map<string, string>>}  threadId -> lowercased routed email.
 *   Pairs whose lookup fails or comes back empty are left out, so callers fall
 *   back to the account email.
 */
export async function alertEmailsFor(supabase, pairs) {
  const out = new Map();
  if (!pairs.length) return out;
  // One call for the whole list (fn_chat_alert_emails, 202611170002, PR 447
  // review), in pages so the request stays a sensible size.
  let batched = true;
  for (let i = 0; i < pairs.length && batched; i += PAGE) {
    const chunk = pairs.slice(i, i + PAGE);
    const { data, error } = await supabase.rpc("fn_chat_alert_emails", {
      p_thread_ids: chunk.map((p) => p.threadId),
      p_user_ids: chunk.map((p) => p.userId),
    });
    if (error) {
      // Not on this database yet (the migration is applied by hand): the
      // per-thread lookups below still give the right answer.
      if (error.code === "PGRST202" || /fn_chat_alert_emails/.test(error.message ?? "")) { batched = false; break; }
      console.error("fn_chat_alert_emails failed:", error);
      continue;
    }
    for (const row of data ?? []) {
      const email = typeof row.email === "string" ? row.email.trim().toLowerCase() : "";
      if (email) out.set(row.thread_id, email);
    }
  }
  if (batched) return out;
  out.clear();
  for (let i = 0; i < pairs.length; i += BATCH) {
    const chunk = pairs.slice(i, i + BATCH);
    const results = await Promise.all(
      chunk.map(({ threadId, userId }) =>
        supabase.rpc("fn_chat_alert_email", { p_thread_id: threadId, p_user_id: userId })
      )
    );
    results.forEach(({ data, error }, j) => {
      if (error) {
        console.error("fn_chat_alert_email failed:", error);
        return;
      }
      const email = typeof data === "string" ? data.trim().toLowerCase() : "";
      if (email) out.set(chunk[j].threadId, email);
    });
  }
  return out;
}
