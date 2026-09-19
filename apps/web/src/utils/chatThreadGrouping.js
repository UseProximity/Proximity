/**
 * Client-side inbox organization for chat threads.
 * Modes: recent (flat) | person (by otherUserId) | listing (by listingId).
 */

export const CHAT_GROUP_MODES = ["recent", "person", "listing"];
export const CHAT_GROUP_MODE_STORAGE_KEY = "proximity.messages.groupMode";

export const CHAT_GROUP_MODE_LABELS = {
  recent: "Recent",
  person: "By person",
  listing: "By listing",
};

/**
 * @param {unknown} value
 * @returns {"recent"|"person"|"listing"}
 */
export function normalizeChatGroupMode(value) {
  if (CHAT_GROUP_MODES.includes(value)) return value;
  return "recent";
}

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

/**
 * @param {object} thread
 * @param {"person"|"listing"} mode
 * @returns {{ key: string, label: string }}
 */
function groupMeta(thread, mode) {
  if (mode === "person") {
    const key = thread?.otherUserId ? String(thread.otherUserId) : "unknown-person";
    const label = thread?.otherUserName?.trim() || "Unknown";
    return { key, label };
  }
  if (thread?.listingId) {
    return {
      key: String(thread.listingId),
      label: thread.listingTitle?.trim() || "Listing",
    };
  }
  return { key: "no-listing", label: "No listing" };
}

/**
 * @param {object[]} threads
 * @param {"recent"|"person"|"listing"} mode
 * @returns {{ mode: string, flat: object[]|null, groups: { key: string, label: string, threads: object[] }[]|null }}
 */
export function groupChatThreads(threads, mode) {
  const normalized = normalizeChatGroupMode(mode);
  const sorted = sortThreadsByRecency(threads);

  if (normalized === "recent") {
    return { mode: normalized, flat: sorted, groups: null };
  }

  const map = new Map();
  for (const thread of sorted) {
    const { key, label } = groupMeta(thread, normalized);
    let group = map.get(key);
    if (!group) {
      group = { key, label, threads: [] };
      map.set(key, group);
    }
    group.threads.push(thread);
  }

  const groups = [...map.values()].sort(
    (a, b) => threadRecencyMs(b.threads[0]) - threadRecencyMs(a.threads[0])
  );

  return { mode: normalized, flat: null, groups };
}
