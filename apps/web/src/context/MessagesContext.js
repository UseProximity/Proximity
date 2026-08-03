/*
 * Global listing-chat data/actions (Favorites-style). Owns inbox threads, per-thread
 * message history, and the active thread's Realtime subscription. Writes and history
 * go through /api/chat/*; Supabase Realtime only pushes new chat_messages INSERTs for
 * the open thread. No UI chrome (widget open, composer text). Consumed later by the
 * /messages page, header badge, floating widget, and listing compose modal.
 */
"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSession } from "next-auth/react";
import { subscribeThreadMessages } from "@/lib/chat/realtime";

const MessagesContext = createContext(null);

function upsertMessage(list, message) {
  if (!message?.id) return list ?? [];
  const prev = list ?? [];
  if (prev.some((m) => m.id === message.id)) return prev;
  return [...prev, message].sort(
    (a, b) => new Date(a.createdAt) - new Date(b.createdAt)
  );
}

function replaceTempMessage(list, tempId, realMessage) {
  const prev = list ?? [];
  const withoutTemp = prev.filter((m) => m.id !== tempId);
  if (withoutTemp.some((m) => m.id === realMessage.id)) return withoutTemp;
  return upsertMessage(withoutTemp, realMessage);
}

export function MessagesProvider({ children }) {
  const { data: session } = useSession();
  const userId = session?.user?.id ?? null;

  const [threads, setThreads] = useState([]);
  const [messagesByThread, setMessagesByThread] = useState({});
  const [activeThreadId, setActiveThreadId] = useState(null);

  const unsubscribeRef = useRef(null);
  const activeThreadIdRef = useRef(null);
  const userIdRef = useRef(userId);

  activeThreadIdRef.current = activeThreadId;
  userIdRef.current = userId;

  const clearChatState = useCallback(() => {
    if (unsubscribeRef.current) {
      unsubscribeRef.current();
      unsubscribeRef.current = null;
    }
    setThreads([]);
    setMessagesByThread({});
    setActiveThreadId(null);
  }, []);

  const refreshThreads = useCallback(async () => {
    if (!userIdRef.current) return [];
    const res = await fetch("/api/chat/threads");
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(body?.error || `Failed to load threads (${res.status})`);
    }
    const data = await res.json();
    const next = Array.isArray(data) ? data : [];
    setThreads(next);
    return next;
  }, []);

  const loadMessages = useCallback(async (threadId) => {
    if (!userIdRef.current || !threadId) return [];
    const res = await fetch(`/api/chat/threads/${threadId}/messages`);
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(body?.error || `Failed to load messages (${res.status})`);
    }
    const data = await res.json();
    const next = Array.isArray(data) ? data : [];
    setMessagesByThread((prev) => {
      // Keep optimistic temps that the history response has not confirmed yet.
      const existing = prev[threadId] ?? [];
      const byId = new Map(next.map((m) => [m.id, m]));
      for (const m of existing) {
        if (String(m.id).startsWith("temp-") && !byId.has(m.id)) {
          byId.set(m.id, m);
        }
      }
      const merged = Array.from(byId.values()).sort(
        (a, b) => new Date(a.createdAt) - new Date(b.createdAt)
      );
      return { ...prev, [threadId]: merged };
    });
    return next;
  }, []);

  const markThreadRead = useCallback(async (threadId) => {
    if (!userIdRef.current || !threadId) return null;
    const res = await fetch(`/api/chat/threads/${threadId}/read`, {
      method: "POST",
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(body?.error || `Failed to mark read (${res.status})`);
    }
    const data = await res.json();
    setThreads((prev) =>
      prev.map((t) =>
        t.threadId === threadId ? { ...t, hasUnread: false } : t
      )
    );
    return data;
  }, []);

  const sendMessage = useCallback(async (threadId, body) => {
    if (!userIdRef.current || !threadId) {
      throw new Error("Not signed in");
    }
    const trimmed = typeof body === "string" ? body.trim() : "";
    if (!trimmed) throw new Error("Message body required");

    const tempId = `temp-${crypto.randomUUID()}`;
    const optimistic = {
      id: tempId,
      threadId,
      senderId: userIdRef.current,
      isMine: true,
      body: trimmed,
      messageType: "text",
      metadata: {},
      createdAt: new Date().toISOString(),
    };

    setMessagesByThread((prev) => ({
      ...prev,
      [threadId]: upsertMessage(prev[threadId], optimistic),
    }));

    try {
      const res = await fetch(`/api/chat/threads/${threadId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: trimmed }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => null);
        throw new Error(errBody?.error || `Failed to send (${res.status})`);
      }
      const data = await res.json();
      const confirmed = { ...optimistic, id: data.messageId };
      setMessagesByThread((prev) => ({
        ...prev,
        [threadId]: replaceTempMessage(prev[threadId], tempId, confirmed),
      }));
      // Inbox preview / unread for the other party — refresh our side.
      refreshThreads().catch(() => {});
      return confirmed;
    } catch (err) {
      setMessagesByThread((prev) => ({
        ...prev,
        [threadId]: (prev[threadId] ?? []).filter((m) => m.id !== tempId),
      }));
      throw err;
    }
  }, [refreshThreads]);

  const startListingChat = useCallback(
    async (listingId, body) => {
      if (!userIdRef.current) throw new Error("Not signed in");
      const trimmed = typeof body === "string" ? body.trim() : "";
      if (!trimmed) throw new Error("Message body required");

      const res = await fetch("/api/chat/threads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listingId, body: trimmed }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => null);
        throw new Error(errBody?.error || `Failed to start chat (${res.status})`);
      }
      const data = await res.json();
      await refreshThreads();
      if (data?.threadId) {
        setActiveThreadId(data.threadId);
      }
      return data;
    },
    [refreshThreads]
  );

  // Bootstrap inbox on login; clear on logout.
  useEffect(() => {
    if (!userId) {
      clearChatState();
      return;
    }
    refreshThreads().catch(() => {});
  }, [userId, clearChatState, refreshThreads]);

  // Open-thread: history → subscribe; refetch on Realtime (re)subscribe.
  useEffect(() => {
    if (!userId || !activeThreadId) {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
      return;
    }

    let cancelled = false;

    loadMessages(activeThreadId).catch(() => {});

    if (unsubscribeRef.current) {
      unsubscribeRef.current();
      unsubscribeRef.current = null;
    }

    unsubscribeRef.current = subscribeThreadMessages(
      activeThreadId,
      (message) => {
        if (cancelled) return;
        setMessagesByThread((prev) => ({
          ...prev,
          [activeThreadId]: upsertMessage(prev[activeThreadId], message),
        }));
        // Keep inbox last-message / unread roughly fresh without a full poller.
        refreshThreads().catch(() => {});
      },
      {
        currentUserId: userId,
        onStatus: (status) => {
          if (cancelled || status !== "SUBSCRIBED") return;
          // Closes history→subscribe race and catches reconnect gaps.
          loadMessages(activeThreadId).catch(() => {});
          refreshThreads().catch(() => {});
        },
      }
    );

    return () => {
      cancelled = true;
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
    };
  }, [userId, activeThreadId, loadMessages, refreshThreads]);

  // Tab visible while a thread is open: refetch messages + inbox.
  useEffect(() => {
    if (!userId) return;

    function onVisibility() {
      if (document.visibilityState !== "visible") return;
      refreshThreads().catch(() => {});
      const threadId = activeThreadIdRef.current;
      if (threadId) loadMessages(threadId).catch(() => {});
    }

    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [userId, loadMessages, refreshThreads]);

  const unreadCount = useMemo(
    () => threads.filter((t) => t.hasUnread).length,
    [threads]
  );

  const value = useMemo(
    () => ({
      threads,
      unreadCount,
      messagesByThread,
      activeThreadId,
      refreshThreads,
      loadMessages,
      sendMessage,
      startListingChat,
      markThreadRead,
      setActiveThreadId,
    }),
    [
      threads,
      unreadCount,
      messagesByThread,
      activeThreadId,
      refreshThreads,
      loadMessages,
      sendMessage,
      startListingChat,
      markThreadRead,
    ]
  );

  return (
    <MessagesContext.Provider value={value}>{children}</MessagesContext.Provider>
  );
}

export function useMessages() {
  const ctx = useContext(MessagesContext);
  if (!ctx) throw new Error("useMessages must be used within MessagesProvider");
  return ctx;
}
