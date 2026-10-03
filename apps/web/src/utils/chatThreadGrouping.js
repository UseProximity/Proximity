/**
 * Inbox ordering for chat threads.
 *
 * This used to offer "By person" and "By listing" groupings alongside a flat
 * recency list. Both went away when a thread stopped meaning "one listing" and
 * started meaning "one landlord and one student": grouping by person now puts
 * exactly one thread in every group, and grouping by listing has to pick a
 * single listing for a conversation that can cover several, so it files threads
 * somewhere misleading. A flat most-recent-first list is what a per-person
 * inbox wants.
 */

/**
 * @param {object} thread
 * @returns {number}
 */
function threadRecencyMs(thread) {
  const iso = thread?.lastMessageAt || thread?.updatedAt;
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/**
 * @param {object[]} threads
 * @returns {object[]}
 */
export function sortThreadsByRecency(threads) {
  return [...(threads || [])].sort(
    (a, b) => threadRecencyMs(b) - threadRecencyMs(a)
  );
}
