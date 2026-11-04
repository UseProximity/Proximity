/*
 * Review sandbox rules for Proxy questions and tours (App Store review accounts,
 * see lib/reviewSandbox.js).
 *
 * A reviewer on a sandbox student account can ask about and tour real listings.
 * None of that may reach the real landlord: it is hidden from a landlord who is
 * not a sandbox account (Questions tab, counts, timeline, tours) and every email
 * about it is suppressed. Nothing tells the reviewer; their side works as usual.
 *
 * A tour is a sandbox tour when its student is a sandbox account. A question is a
 * sandbox question when every student waiting on it is a sandbox account. Sandbox
 * askers never share a question row with real ones (askLandlord keeps them apart),
 * so the "every" only matters for rows made before that rule: a mixed row stays
 * visible, as a real student is waiting on it.
 *
 * Lookups throw SandboxLookupError after their retries, like the inbox filter, so
 * a failed lookup shows an error rather than an unfiltered list.
 */
import supabase from "@/lib/supabase";
import { allSandboxUserIds, sandboxIdsAmong } from "@/lib/reviewSandbox";

/* The ids among `questionIds` that only sandbox students are waiting on. */
export async function sandboxQuestionIds(questionIds, sandboxIds = null) {
  const ids = [...new Set((questionIds ?? []).filter(Boolean))];
  if (!ids.length) return new Set();
  const sandbox = sandboxIds ?? (await allSandboxUserIds());
  if (!sandbox.size) return new Set();
  const waiters = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase.from("listing_question_waiters").select("question_id, user_id").in("question_id", ids.slice(i, i + 200));
    if (error) throw new Error(`question waiters: ${error.message}`);
    waiters.push(...(data ?? []));
  }
  const real = new Set();
  const seen = new Set();
  for (const w of waiters) {
    seen.add(w.question_id);
    if (!w.user_id || !sandbox.has(w.user_id)) real.add(w.question_id);
  }
  return new Set([...seen].filter((id) => !real.has(id)));
}

/* Is this one question a sandbox question? */
export async function isSandboxQuestion(questionId) {
  return (await sandboxQuestionIds([questionId])).has(questionId);
}

/*
 * What a landlord may see, from one lookup: `tours(rows)` and `questions(rows)` drop
 * the sandbox ones. A sandbox landlord sees everything, anyone else sees no sandbox
 * tour or question. `hidesNothing` is true when nothing would be dropped.
 */
export async function sandboxViewFor(viewerId) {
  const sandboxIds = await allSandboxUserIds();
  const viewerIsSandbox = !!viewerId && sandboxIds.has(viewerId);
  const hidesNothing = viewerIsSandbox || sandboxIds.size === 0;
  return {
    sandboxIds,
    hidesNothing,
    tours: (rows, studentIdOf = (t) => t.student_id ?? t.studentId) =>
      hidesNothing ? rows : (rows ?? []).filter((t) => !sandboxIds.has(studentIdOf(t))),
    questions: async (rows, idOf = (q) => q.id) => {
      if (hidesNothing || !rows?.length) return rows ?? [];
      const hidden = await sandboxQuestionIds(rows.map(idOf), sandboxIds);
      return hidden.size ? rows.filter((q) => !hidden.has(idOf(q))) : rows;
    },
  };
}

/* Is this user a sandbox account? Throws SandboxLookupError when it cannot tell. */
export async function isSandboxUser(userId) {
  if (!userId) return false;
  return (await sandboxIdsAmong([userId])).has(userId);
}
