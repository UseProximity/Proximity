/*
 * Chat block and report support, kept out of the chat RPCs on purpose.
 *
 * Blocking reuses user_blocks and is enforced here, in the routes, so the existing
 * chat database functions are untouched:
 *   - starting a chat or sending into a thread is refused when either person has
 *     blocked the other (assertThreadNotBlocked / assertListingContactNotBlocked)
 *   - the inbox hides threads the viewer blocked and marks threads the other person
 *     blocked as `unavailable` (applyBlocksToInbox)
 * The block and report routes also derive their target from the thread, never from
 * the client, so a caller can only act on someone they are actually talking to.
 */
import supabase from "@/lib/supabase";

/**
 * @returns {Promise<
 *   { ok: true, otherUserId: string }
 *   | { ok: false, status: 400 | 403 | 500, error: string }
 * >}
 */
export async function resolveThreadCounterpart(threadId, userId) {
  const { data, error } = await supabase
    .from("chat_participants")
    .select("user_id")
    .eq("thread_id", threadId);

  if (error) {
    console.error("resolveThreadCounterpart failed:", error);
    return { ok: false, status: 500, error: "Server error" };
  }

  const ids = (data ?? []).map((row) => row.user_id);
  // A non-participant must not learn whether the thread exists.
  if (!ids.includes(userId)) {
    return { ok: false, status: 403, error: "Forbidden" };
  }

  const others = ids.filter((id) => id !== userId);
  if (others.length !== 1) {
    return { ok: false, status: 400, error: "This conversation has no one else to act on" };
  }
  return { ok: true, otherUserId: others[0] };
}

export const CONVERSATION_UNAVAILABLE_MESSAGE = "This conversation is unavailable";

function unavailableResult() {
  return { ok: false, status: 403, error: CONVERSATION_UNAVAILABLE_MESSAGE };
}

// Blocks between the viewer and a set of other people, in both directions.
async function loadBlocks(userId, otherIds) {
  const ids = [...new Set(otherIds.filter(Boolean))];
  const empty = { blockedByMe: new Set(), blockedMe: new Set() };
  if (ids.length === 0) return { ok: true, ...empty };

  const [mine, theirs] = await Promise.all([
    supabase.from("user_blocks").select("blocked_id").eq("blocker_id", userId).in("blocked_id", ids),
    supabase.from("user_blocks").select("blocker_id").eq("blocked_id", userId).in("blocker_id", ids),
  ]);
  if (mine.error || theirs.error) {
    console.error("chat loadBlocks failed:", mine.error || theirs.error);
    return { ok: false, status: 500, error: "Server error" };
  }
  return {
    ok: true,
    blockedByMe: new Set((mine.data ?? []).map((r) => r.blocked_id)),
    blockedMe: new Set((theirs.data ?? []).map((r) => r.blocker_id)),
  };
}

/**
 * Refuse a send into a thread when either person has blocked the other. A caller
 * who is not in the thread passes through, so the RPC still answers them exactly
 * as it did before. Fails closed if the block lookup errors.
 *
 * @returns {Promise<{ ok: true } | { ok: false, status: number, error: string }>}
 */
export async function assertThreadNotBlocked(threadId, userId) {
  const { data, error } = await supabase
    .from("chat_participants")
    .select("user_id")
    .eq("thread_id", threadId);
  if (error) {
    console.error("assertThreadNotBlocked failed:", error);
    return { ok: false, status: 500, error: "Server error" };
  }
  const ids = (data ?? []).map((row) => row.user_id);
  if (!ids.includes(userId)) return { ok: true };

  const blocks = await loadBlocks(userId, ids.filter((id) => id !== userId));
  if (!blocks.ok) return blocks;
  if (blocks.blockedByMe.size > 0 || blocks.blockedMe.size > 0) return unavailableResult();
  return { ok: true };
}

/**
 * Same rule for starting a chat about a listing. The recipient is resolved with
 * the same function the start RPC uses, so a lease-specific enquiry is checked
 * against the landlord it would actually reach. Anything unresolved passes through
 * for the RPC to reject as before.
 */
export async function assertListingContactNotBlocked(userId, listingId, leaseId = null) {
  const { data: landlordId, error } = await supabase.rpc("fn_chat_resolve_landlord", {
    p_listing_id: listingId,
    p_lease_id: leaseId,
  });
  if (error) {
    console.error("assertListingContactNotBlocked failed:", error);
    return { ok: false, status: 500, error: "Server error" };
  }
  if (!landlordId) return { ok: true };

  const blocks = await loadBlocks(userId, [landlordId]);
  if (!blocks.ok) return blocks;
  if (blocks.blockedByMe.size > 0 || blocks.blockedMe.size > 0) return unavailableResult();
  return { ok: true };
}

/**
 * Inbox view of blocks: threads the viewer blocked are dropped, threads where the
 * other person blocked the viewer stay but carry `unavailable: true`. Fails open on
 * a lookup error, since this only shapes the list and sends are enforced above.
 */
export async function applyBlocksToInbox(userId, threads) {
  if (!Array.isArray(threads) || threads.length === 0) return threads ?? [];
  const blocks = await loadBlocks(userId, threads.map((t) => t.otherUserId));
  if (!blocks.ok) return threads;
  return threads
    .filter((t) => !blocks.blockedByMe.has(t.otherUserId))
    .map((t) => ({ ...t, unavailable: blocks.blockedMe.has(t.otherUserId) }));
}
