/*
 * Global listing-chat data/actions (Favorites-style). Owns inbox threads, per-thread
 * message history, and Realtime subscriptions. Writes and history go through
 * /api/chat/*; Supabase Realtime pushes chat_messages INSERTs — inbox-wide for
 * badge/preview refresh, and thread-scoped for the open chat. Opening a thread
 * (and receiving live messages while it's open) marks it read via
 * POST /api/chat/threads/[id]/read, but only while the tab is visible.
 * Also tracks the other participant's
 * last_read_at for "Read · time" receipts in ChatTranscript. Prefetches recent
 * thread histories so opening a conversation feels instant. No UI chrome
 * (composer text lives in ChatTranscript). Consumed by /messages, header
 * unread badge, and listing Message CTA via startListingChat.
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
import {
  subscribeInboxMessages,
  subscribeThreadMessages,
  subscribeThreadReadReceipts,
} from "@/lib/chat/realtime";

const MessagesContext = createContext(null);

/** How many inbox threads to warm after the inbox loads. */
const PREFETCH_THREAD_COUNT = 5;

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

function patchMessage(list, message) {
  if (!message?.id) return list ?? [];
  const prev = list ?? [];
  const idx = prev.findIndex((m) => m.id === message.id);
  if (idx === -1) return upsertMessage(prev, message);
  const next = [...prev];
  next[idx] = { ...next[idx], ...message };
  return next;
}

function formatOfferBody(proposedRent) {
  const n = Number(proposedRent);
  if (!Number.isFinite(n)) return "Offer";
  return `Offer: $${Math.round(n).toLocaleString()}/mo`;
}

export function MessagesProvider({ children }) {
  const { data: session, status: sessionStatus } = useSession();
  const userId = session?.user?.id ?? null;

  const [threads, setThreads] = useState([]);
  const [threadsStatus, setThreadsStatus] = useState("idle"); // idle | loading | ready | error
  const [messagesByThread, setMessagesByThread] = useState({});
  // per thread: loading | ready | error — undefined means never requested
  const [messagesStatusByThread, setMessagesStatusByThread] = useState({});
  const [activeThreadId, setActiveThreadId] = useState(null);

  const threadUnsubscribeRef = useRef(null);
  const inboxUnsubscribeRef = useRef(null);
  const activeThreadIdRef = useRef(null);
  const userIdRef = useRef(userId);
  const refreshSeqRef = useRef(0);
  const messagesStatusRef = useRef({});
  const loadInFlightRef = useRef(new Map());

  activeThreadIdRef.current = activeThreadId;
  userIdRef.current = userId;
  messagesStatusRef.current = messagesStatusByThread;

  const clearChatState = useCallback(() => {
    refreshSeqRef.current += 1;
    loadInFlightRef.current.clear();
    if (threadUnsubscribeRef.current) {
      threadUnsubscribeRef.current();
      threadUnsubscribeRef.current = null;
    }
    if (inboxUnsubscribeRef.current) {
      inboxUnsubscribeRef.current();
      inboxUnsubscribeRef.current = null;
    }
    setThreads([]);
    setThreadsStatus("idle");
    setMessagesByThread({});
    setMessagesStatusByThread({});
    setActiveThreadId(null);
  }, []);

  const refreshThreads = useCallback(async () => {
    if (!userIdRef.current) return [];
    const seq = ++refreshSeqRef.current;
    setThreadsStatus((prev) => (prev === "ready" ? "ready" : "loading"));
    try {
      const res = await fetch("/api/chat/threads");
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || `Failed to load threads (${res.status})`);
      }
      const data = await res.json();
      const next = Array.isArray(data) ? data : [];
      if (seq !== refreshSeqRef.current) return next;
      setThreads(next);
      setThreadsStatus("ready");
      return next;
    } catch (err) {
      if (seq === refreshSeqRef.current) {
        setThreadsStatus((prev) => (prev === "ready" ? "ready" : "error"));
      }
      throw err;
    }
  }, []);

  const loadMessages = useCallback(async (threadId) => {
    if (!userIdRef.current || !threadId) return [];

    const inFlight = loadInFlightRef.current.get(threadId);
    if (inFlight) return inFlight;

    // Keep "ready" during background refresh so the transcript doesn't flash a spinner.
    setMessagesStatusByThread((prev) => {
      if (prev[threadId] === "ready") return prev;
      return { ...prev, [threadId]: "loading" };
    });

    const request = (async () => {
      try {
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
        setMessagesStatusByThread((prev) => ({ ...prev, [threadId]: "ready" }));
        return next;
      } catch (err) {
        setMessagesStatusByThread((prev) => {
          if (prev[threadId] === "ready") return prev;
          return { ...prev, [threadId]: "error" };
        });
        throw err;
      } finally {
        loadInFlightRef.current.delete(threadId);
      }
    })();

    loadInFlightRef.current.set(threadId, request);
    return request;
  }, []);

  /** Warm a thread's history if not already ready / in flight. */
  const prefetchMessages = useCallback(
    (threadId) => {
      if (!userIdRef.current || !threadId) return;
      if (messagesStatusRef.current[threadId] === "ready") return;
      if (loadInFlightRef.current.has(threadId)) return;
      loadMessages(threadId).catch(() => {});
    },
    [loadMessages]
  );

  const markThreadRead = useCallback(async (threadId) => {
    if (!userIdRef.current || !threadId) return null;

    // A hidden tab isn't being read, whatever the thread state says. Without this, a
    // background /messages tab marks incoming messages read — telling the sender they were
    // seen, and suppressing the notification email that should have gone out instead.
    if (typeof document !== "undefined" && document.visibilityState !== "visible") {
      return null;
    }

    // Clear badge immediately; restore via inbox refresh if the request fails.
    setThreads((prev) =>
      prev.map((t) =>
        t.threadId === threadId
          ? { ...t, hasUnread: false, unreadCount: 0 }
          : t
      )
    );

    try {
      const res = await fetch(`/api/chat/threads/${threadId}/read`, {
        method: "POST",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || `Failed to mark read (${res.status})`);
      }
      return await res.json();
    } catch (err) {
      refreshThreads().catch(() => {});
      throw err;
    }
  }, [refreshThreads]);

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

  const sendOffer = useCallback(
    async (threadId, { proposedRent, note, parentOfferId } = {}) => {
      if (!userIdRef.current || !threadId) {
        throw new Error("Not signed in");
      }
      const rent = Number(proposedRent);
      if (!Number.isFinite(rent) || rent <= 0) {
        throw new Error("proposedRent must be a positive number");
      }

      const tempId = `temp-${crypto.randomUUID()}`;
      const metadata = {
        status: "pending",
        proposedRent: rent,
        originalRent: null,
        note: note?.trim() || null,
        parentOfferId: parentOfferId ?? null,
        respondedAt: null,
        respondedBy: null,
      };
      const optimistic = {
        id: tempId,
        threadId,
        senderId: userIdRef.current,
        isMine: true,
        body: formatOfferBody(rent),
        messageType: "discount_offer",
        metadata,
        createdAt: new Date().toISOString(),
      };

      setMessagesByThread((prev) => {
        const list = (prev[threadId] ?? []).map((m) => {
          if (
            m.messageType === "discount_offer" &&
            (m.metadata?.status || "pending") === "pending"
          ) {
            return {
              ...m,
              metadata: { ...m.metadata, status: "superseded" },
            };
          }
          return m;
        });
        return {
          ...prev,
          [threadId]: upsertMessage(list, optimistic),
        };
      });

      try {
        const res = await fetch(`/api/chat/threads/${threadId}/offers`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            proposedRent: rent,
            note: note?.trim() || undefined,
            parentOfferId: parentOfferId || undefined,
          }),
        });
        if (!res.ok) {
          const errBody = await res.json().catch(() => null);
          throw new Error(errBody?.error || `Failed to send offer (${res.status})`);
        }
        const data = await res.json();
        const confirmed = {
          ...optimistic,
          id: data.messageId,
          body: data.body || optimistic.body,
          metadata: data.metadata || metadata,
        };
        setMessagesByThread((prev) => ({
          ...prev,
          [threadId]: replaceTempMessage(prev[threadId], tempId, confirmed),
        }));
        refreshThreads().catch(() => {});
        return confirmed;
      } catch (err) {
        setMessagesByThread((prev) => ({
          ...prev,
          [threadId]: (prev[threadId] ?? []).filter((m) => m.id !== tempId),
        }));
        // Reload to restore superseded statuses if optimistic patch was wrong.
        loadMessages(threadId).catch(() => {});
        throw err;
      }
    },
    [refreshThreads, loadMessages]
  );

  const respondOffer = useCallback(
    async (messageId, action, { proposedRent, note } = {}) => {
      if (!userIdRef.current || !messageId) {
        throw new Error("Not signed in");
      }

      const res = await fetch(`/api/chat/offers/${messageId}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          proposedRent,
          note: note?.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => null);
        throw new Error(errBody?.error || `Failed to respond (${res.status})`);
      }
      const data = await res.json();
      const threadId = data.threadId;

      if (action === "counter" && threadId) {
        // New offer row; also mark others superseded via reload for accuracy.
        await loadMessages(threadId);
      } else if (threadId && data.messageId) {
        setMessagesByThread((prev) => ({
          ...prev,
          [threadId]: patchMessage(prev[threadId], {
            id: data.messageId,
            threadId,
            body: data.body,
            messageType: "discount_offer",
            metadata: data.metadata,
          }),
        }));
      }

      refreshThreads().catch(() => {});
      return data;
    },
    [loadMessages, refreshThreads]
  );

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

  // Bootstrap inbox on login; clear on logout. Ignore session "loading" so we
  // don't wipe threads (or flash the empty state) before NextAuth hydrates.
  useEffect(() => {
    if (sessionStatus === "loading") return;
    if (!userId) {
      clearChatState();
      return;
    }

    let cancelled = false;
    let retryTimer = null;

    function loadInbox(attempt = 0) {
      refreshThreads().catch(() => {
        if (cancelled) return;
        if (attempt >= 2) return;
        retryTimer = setTimeout(() => loadInbox(attempt + 1), 400 * (attempt + 1));
      });
    }

    loadInbox();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [userId, sessionStatus, clearChatState, refreshThreads]);

  // Warm the most recent threads so opening them feels instant.
  useEffect(() => {
    if (!userId || threadsStatus !== "ready" || threads.length === 0) return;
    const ids = threads
      .slice(0, PREFETCH_THREAD_COUNT)
      .map((t) => t.threadId)
      .filter(Boolean);
    for (const id of ids) {
      prefetchMessages(id);
    }
  }, [userId, threads, threadsStatus, prefetchMessages]);

  // Inbox Realtime: any participant-visible INSERT → refresh badge / previews.
  // If a thread is open, mark it read first so a live reply in-view doesn't bump the badge.
  useEffect(() => {
    if (!userId) {
      if (inboxUnsubscribeRef.current) {
        inboxUnsubscribeRef.current();
        inboxUnsubscribeRef.current = null;
      }
      return;
    }

    let cancelled = false;

    if (inboxUnsubscribeRef.current) {
      inboxUnsubscribeRef.current();
      inboxUnsubscribeRef.current = null;
    }

    function refreshInbox() {
      if (cancelled) return;
      const openId = activeThreadIdRef.current;
      if (openId) {
        markThreadRead(openId)
          .catch(() => {})
          .finally(() => {
            if (!cancelled) refreshThreads().catch(() => {});
          });
        return;
      }
      refreshThreads().catch(() => {});
    }

    inboxUnsubscribeRef.current = subscribeInboxMessages(refreshInbox, {
      currentUserId: userId,
      onStatus: (status) => {
        if (cancelled || status !== "SUBSCRIBED") return;
        refreshInbox();
      },
    });

    return () => {
      cancelled = true;
      if (inboxUnsubscribeRef.current) {
        inboxUnsubscribeRef.current();
        inboxUnsubscribeRef.current = null;
      }
    };
  }, [userId, refreshThreads, markThreadRead]);

  // Open-thread: mark read → history → subscribe to messages + other user's
  // last_read_at (read receipts). Incoming messages also mark read.
  useEffect(() => {
    if (!userId || !activeThreadId) {
      if (threadUnsubscribeRef.current) {
        threadUnsubscribeRef.current();
        threadUnsubscribeRef.current = null;
      }
      return;
    }

    let cancelled = false;
    let unsubMessages = null;
    let unsubReadReceipts = null;

    markThreadRead(activeThreadId).catch(() => {});
    loadMessages(activeThreadId).catch(() => {});

    if (threadUnsubscribeRef.current) {
      threadUnsubscribeRef.current();
      threadUnsubscribeRef.current = null;
    }

    unsubMessages = subscribeThreadMessages(
      activeThreadId,
      (message, eventType = "INSERT") => {
        if (cancelled) return;
        if (eventType === "UPDATE") {
          setMessagesByThread((prev) => ({
            ...prev,
            [activeThreadId]: patchMessage(prev[activeThreadId], message),
          }));
          return;
        }
        setMessagesByThread((prev) => ({
          ...prev,
          [activeThreadId]: upsertMessage(prev[activeThreadId], message),
        }));
        if (message && message.isMine === false) {
          markThreadRead(activeThreadId).catch(() => {});
        }
      },
      {
        currentUserId: userId,
        onStatus: (status) => {
          if (cancelled || status !== "SUBSCRIBED") return;
          loadMessages(activeThreadId).catch(() => {});
          markThreadRead(activeThreadId).catch(() => {});
        },
      }
    );

    unsubReadReceipts = subscribeThreadReadReceipts(
      activeThreadId,
      ({ userId: readerId, lastReadAt }) => {
        if (cancelled || !lastReadAt || readerId === userId) return;
        setThreads((prev) =>
          prev.map((t) =>
            t.threadId === activeThreadId
              ? { ...t, otherUserLastReadAt: lastReadAt }
              : t
          )
        );
      }
    );

    threadUnsubscribeRef.current = () => {
      unsubMessages?.();
      unsubReadReceipts?.();
    };

    return () => {
      cancelled = true;
      if (threadUnsubscribeRef.current) {
        threadUnsubscribeRef.current();
        threadUnsubscribeRef.current = null;
      }
    };
  }, [userId, activeThreadId, loadMessages, markThreadRead]);

  // Tab visible while a thread is open: mark read + refetch messages + inbox.
  useEffect(() => {
    if (!userId) return;

    function onVisibility() {
      if (document.visibilityState !== "visible") return;
      const threadId = activeThreadIdRef.current;
      if (threadId) {
        markThreadRead(threadId).catch(() => {});
        loadMessages(threadId).catch(() => {});
      }
      refreshThreads().catch(() => {});
    }

    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [userId, loadMessages, refreshThreads, markThreadRead]);

  const unreadCount = useMemo(
    () =>
      threads.reduce((sum, t) => {
        if (typeof t.unreadCount === "number") return sum + t.unreadCount;
        return sum + (t.hasUnread ? 1 : 0);
      }, 0),
    [threads]
  );

  const value = useMemo(
    () => ({
      threads,
      threadsStatus,
      threadsLoading: threadsStatus === "loading" || threadsStatus === "idle",
      unreadCount,
      messagesByThread,
      messagesStatusByThread,
      activeThreadId,
      refreshThreads,
      loadMessages,
      prefetchMessages,
      sendMessage,
      sendOffer,
      respondOffer,
      startListingChat,
      markThreadRead,
      setActiveThreadId,
    }),
    [
      threads,
      threadsStatus,
      unreadCount,
      messagesByThread,
      messagesStatusByThread,
      activeThreadId,
      refreshThreads,
      loadMessages,
      prefetchMessages,
      sendMessage,
      sendOffer,
      respondOffer,
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
