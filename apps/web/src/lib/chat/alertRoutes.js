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

/**
 * @param {object} supabase  a service client for the chosen database
 * @param {Array<{threadId: string, userId: string}>} pairs
 * @returns {Promise<Map<string, string>>}  threadId -> lowercased routed email.
 *   Pairs whose lookup fails or comes back empty are left out, so callers fall
 *   back to the account email.
 */
export async function alertEmailsFor(supabase, pairs) {
  const out = new Map();
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
