// Total unread chat messages, for the badge on the Chat tab. The count always
// comes from the server (the same per-thread `unreadCount` the inbox shows, summed
// like web's header badge), so it survives app restarts. It is refreshed when the
// app loads, returns to the foreground, the inbox reloads, and after a thread is
// marked read. There is no realtime on mobile yet.
import { create } from "zustand";
import apiClient from "../lib/apiClient";

export function countUnread(threads) {
  return (Array.isArray(threads) ? threads : []).reduce((sum, thread) => {
    if (typeof thread.unreadCount === "number") return sum + thread.unreadCount;
    return sum + (thread.hasUnread ? 1 : 0);
  }, 0);
}

export const useChatUnreadStore = create((set) => ({
  unreadCount: 0,

  // The inbox already has the threads in hand, so it can set the count directly.
  setFromThreads: (threads) => set({ unreadCount: countUnread(threads) }),

  refresh: async () => {
    try {
      const threads = await apiClient.chat.listThreads();
      set({ unreadCount: countUnread(threads) });
    } catch {
      // Keep the last known count: a failed refresh should not make unread mail vanish.
    }
  },

  reset: () => set({ unreadCount: 0 }),
}));
