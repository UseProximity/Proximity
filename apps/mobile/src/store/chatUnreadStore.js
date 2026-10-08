// Total unread chat messages, for the badge on the Chat tab. The count always
// comes from the server (the same per-thread `unreadCount` the inbox shows, summed
// like web's header badge), so it survives app restarts. It is refreshed when the
// app loads, returns to the foreground, the inbox reloads, after a thread is
// marked read, and when realtime reports a new message.
//
// The store also carries the little bit of shared state realtime needs between
// the tab layout (which owns the inbox subscription) and the screens:
//   inboxActive / inboxVersion  when the inbox screen is on screen it reloads
//                               its own list on a new message (its load also
//                               sets the count); otherwise the layout just
//                               refreshes the count.
//   activeThreadId              the conversation currently open, whose incoming
//                               messages are marked read by that screen, so the
//                               badge does not blip up and back down.
import { create } from "zustand";
import apiClient from "../lib/apiClient";

export function countUnread(threads) {
  return (Array.isArray(threads) ? threads : []).reduce((sum, thread) => {
    if (typeof thread.unreadCount === "number") return sum + thread.unreadCount;
    return sum + (thread.hasUnread ? 1 : 0);
  }, 0);
}

export const useChatUnreadStore = create((set, get) => ({
  unreadCount: 0,
  inboxActive: false,
  inboxVersion: 0,
  activeThreadId: null,

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

  setInboxActive: (inboxActive) => set({ inboxActive }),
  setActiveThreadId: (activeThreadId) => set({ activeThreadId }),

  // Realtime saw a message (or just (re)connected). `threadId` is omitted on a
  // reconnect, when anything may have been missed.
  notifyInboxChanged: (threadId) => {
    const { inboxActive, activeThreadId, refresh } = get();
    if (inboxActive) {
      set((state) => ({ inboxVersion: state.inboxVersion + 1 }));
    } else if (!threadId || threadId !== activeThreadId) {
      refresh();
    }
  },

  reset: () => set({ unreadCount: 0, inboxVersion: 0, activeThreadId: null }),
}));
