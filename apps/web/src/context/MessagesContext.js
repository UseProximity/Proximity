/*
 * Global listing-chat data/actions (Favorites-style). Owns inbox threads, per-thread
 * message history, and Realtime subscriptions. Writes and history go through
 * /api/chat/*; Supabase Realtime pushes chat_messages INSERTs, inbox-wide for
 * badge/preview refresh, and thread-scoped for the open chat. Opening a thread
 * (and receiving live messages while it's open) marks it read via
 * POST /api/chat/threads/[id]/read, but only while the tab is visible.
 * Also tracks the other participant's
 * last_read_at for "Read · time" receipts in ChatTranscript. Prefetches recent
 * thread histories so opening a conversation feels instant. No UI chrome
 * (composer text lives in ChatTranscript). Consumed by /messages, header
 * unread badge, and the listing modal's Message CTA via startListingChat.
 *
 * View as (Wyatt, 2026-11-03): an admin can open someone else's inbox,
 * exactly as they see it, with ?messages=1&viewAs=<user id>. The overlay
 * calls setViewAs; every read then asks the server for that person's inbox,
 * and every write is refused here (send, start a chat, mark read), so a look
 * never reads as "seen" to anyone or says anything on their behalf. The
 * server only honours viewAs for admins and only on reads.
 */
"use client";

import { trackEvent } from "@/utils/analytics";
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
import { onLandlordChange, onInboxChange } from "@/components/landlord/landlordSync";

import {
  subscribeInboxMessages,
  subscribeThreadMessages,
  subscribeThreadReadReceipts,
} from "@/lib/chat/realtime";
import {
  attachmentPreviewBody,
  compressChatImage,
  CHAT_ATTACHMENT_ALLOWED_TYPES,
  CHAT_ATTACHMENT_MAX_BYTES,
  CHAT_ATTACHMENT_MAX_FILES,
} from "@/lib/chat/attachments";

const MessagesContext = createContext(null);

// A read URL that asks for the viewed person's copy while an admin views as them.
function withViewAs(url, viewAsId) {
  if (!viewAsId) return url;
  return `${url}${url.includes("?") ? "&" : "?"}viewAs=${encodeURIComponent(viewAsId)}`;
}

// How often an open conversation and the inbox look for news when the live
// channel stays quiet (Wyatt, 2026-11-02).
const LIVE_POLL_MS = 4000;
const INBOX_POLL_MS = 20000;

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

/*
 * Why a send was refused, for the event stream. The content screen answers 422
 * and the rate limiter 429, and both are product signals rather than faults:
 * without them "messages sent" and "messages attempted" look identical and
 * there is no way to tell a moderation false positive from a quiet user.
 */
/*
 * A 409 CONFIRM_SEND response means the server wants the sender to confirm a
 * message with contact details in it. It is surfaced as an error carrying the
 * code so the composer can show "send anyway?" instead of a failure toast, and
 * re-send with confirmed: true.
 */
export const CHAT_CONFIRM_SEND_CODE = "CONFIRM_SEND";

function rejectionError(errBody, fallback) {
  const err = new Error(errBody?.error || fallback);
  if (errBody?.code) err.code = errBody.code;
  if (Array.isArray(errBody?.reasons)) err.reasons = errBody.reasons;
  return err;
}

function sendRejectionKind(status) {
  if (status === 422) return "blocked";
  if (status === 409) return "needs_confirmation";
  if (status === 429) return "rate_limited";
  if (status === 403) return "password_required";
  return "error";
}

export const VIEW_AS_READ_ONLY_MESSAGE = "You are viewing someone else's inbox. It is read only.";

export function MessagesProvider({ children }) {
  const { data: session, status: sessionStatus } = useSession();
  const userId = session?.user?.id ?? null;
  const canViewAs = ["super", "admin"].includes(session?.user?.role);
  const [viewAsState, setViewAsState] = useState(null);
  const viewAs = canViewAs ? viewAsState : null;

  const [threads, setThreads] = useState([]);
  const [threadsStatus, setThreadsStatus] = useState("idle"); // idle | loading | ready | error
  const [messagesByThread, setMessagesByThread] = useState({});
  // per thread: loading | ready | error. Undefined means never requested
  const [messagesStatusByThread, setMessagesStatusByThread] = useState({});
  const [activeThreadId, setActiveThreadId] = useState(null);
  /*
   * Set when a send comes back PASSWORD_REQUIRED. The composer swaps itself for
   * the set-password prompt rather than repeating a toast the user cannot act on.
   */
  const [needsPassword, setNeedsPassword] = useState(false);

  const threadUnsubscribeRef = useRef(null);
  const inboxUnsubscribeRef = useRef(null);
  const activeThreadIdRef = useRef(null);
  const userIdRef = useRef(userId);
  const refreshSeqRef = useRef(0);
  const messagesStatusRef = useRef({});
  const loadInFlightRef = useRef(new Map());

  const viewAsRef = useRef(null);
  viewAsRef.current = viewAs;
  const lastViewAsRef = useRef(undefined);
  // Whose inbox the state now holds (null: the user's own), set once a switch
  // has cleared the old one, so a thread opened by URL is not wiped by it.
  const [inboxFor, setInboxFor] = useState(undefined);

  activeThreadIdRef.current = activeThreadId;
  userIdRef.current = userId;
  messagesStatusRef.current = messagesStatusByThread;
  // A student's Proxy conversations sit in the same inbox (kind "proxy") but
  // are loaded, read and sent through the Proxy routes by ProxyThread, so the
  // direct-chat paths below skip them.
  const threadKindRef = useRef(new Map());
  threadKindRef.current = new Map(threads.map((t) => [t.threadId, t.kind ?? "direct"]));

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
      // Proxy conversations are opt-in on this endpoint (the mobile app does not show them yet).
      const res = await fetch(withViewAs("/api/chat/threads?include=proxy", viewAsRef.current));
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
    if (String(threadKindRef.current.get(threadId) ?? "").startsWith("proxy")) return [];

    const inFlight = loadInFlightRef.current.get(threadId);
    if (inFlight) return inFlight;

    // Keep "ready" during background refresh so the transcript doesn't flash a spinner.
    setMessagesStatusByThread((prev) => {
      if (prev[threadId] === "ready") return prev;
      return { ...prev, [threadId]: "loading" };
    });

    const request = (async () => {
      try {
        const res = await fetch(withViewAs(`/api/chat/threads/${threadId}/messages`, viewAsRef.current));
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
    // Viewing someone else's inbox never marks anything read for them.
    if (viewAsRef.current) return null;
    if (String(threadKindRef.current.get(threadId) ?? "").startsWith("proxy")) {
      // ProxyThread's own fetch marks it read on the server; clear the badge here.
      setThreads((prev) => prev.map((t) => (t.threadId === threadId ? { ...t, hasUnread: false, unreadCount: 0 } : t)));
      return null;
    }

    // A hidden tab isn't being read, whatever the thread state says. Without this, a
    // background /messages tab marks incoming messages read, telling the sender they were
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

  const sendMessage = useCallback(async (threadId, body, files = [], options = {}) => {
    if (!userIdRef.current || !threadId) {
      throw new Error("Not signed in");
    }
    if (viewAsRef.current) throw new Error(VIEW_AS_READ_ONLY_MESSAGE);
    const trimmed = typeof body === "string" ? body.trim() : "";
    const rawFiles = Array.isArray(files) ? files.filter(Boolean) : [];
    const confirmedSend = options?.confirmed === true;

    if (rawFiles.length === 0) {
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
          body: JSON.stringify({ body: trimmed, confirmed: confirmedSend }),
        });
        if (!res.ok) {
          const errBody = await res.json().catch(() => null);
          trackEvent("chat_message_rejected", {
            threadId,
            reason: sendRejectionKind(res.status),
          });
          if (errBody?.code === "PASSWORD_REQUIRED") setNeedsPassword(true);
          throw rejectionError(errBody, `Failed to send (${res.status})`);
        }
        const data = await res.json();
        trackEvent("chat_message_sent", { threadId, hasAttachments: false });
        // The RPC resolves which listing a reply inherits, so take it from the
        // response rather than leaving the optimistic row without context.
        const confirmed = {
          ...optimistic,
          id: data.messageId,
          listingId: data.listingId ?? null,
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
        throw err;
      }
    }

    if (rawFiles.length > CHAT_ATTACHMENT_MAX_FILES) {
      throw new Error(`Max ${CHAT_ATTACHMENT_MAX_FILES} files`);
    }

    const prepared = [];
    for (const file of rawFiles) {
      let next = file;
      if (file.type?.startsWith("image/") || file.type === "image/heic") {
        next = await compressChatImage(file);
      }
      if (!CHAT_ATTACHMENT_ALLOWED_TYPES.has(next.type)) {
        throw new Error("Images (JPEG, PNG, WebP, GIF) and PDFs only");
      }
      if (!Number.isFinite(next.size) || next.size <= 0 || next.size > CHAT_ATTACHMENT_MAX_BYTES) {
        throw new Error("Each file must be 20MB or smaller");
      }
      prepared.push(next);
    }

    const tempId = `temp-${crypto.randomUUID()}`;
    const localPreviews = prepared.map((file) => ({
      id: `local-${crypto.randomUUID()}`,
      fileName: file.name,
      contentType: file.type,
      sizeBytes: file.size,
      localUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
    }));
    const previewBody = trimmed || attachmentPreviewBody(prepared);
    const optimistic = {
      id: tempId,
      threadId,
      senderId: userIdRef.current,
      isMine: true,
      body: previewBody,
      messageType: "attachment",
      metadata: {
        caption: trimmed || null,
        attachments: localPreviews,
      },
      createdAt: new Date().toISOString(),
    };

    setMessagesByThread((prev) => ({
      ...prev,
      [threadId]: upsertMessage(prev[threadId], optimistic),
    }));

    try {
      const presignRes = await fetch(
        `/api/chat/threads/${threadId}/attachments/presign`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            files: prepared.map((f) => ({
              name: f.name,
              type: f.type,
              size: f.size,
            })),
          }),
        }
      );
      if (!presignRes.ok) {
        const errBody = await presignRes.json().catch(() => null);
        throw new Error(errBody?.error || `Failed to prepare upload (${presignRes.status})`);
      }
      const { presigned } = await presignRes.json();
      if (!Array.isArray(presigned) || presigned.length !== prepared.length) {
        throw new Error("Failed to prepare upload");
      }

      await Promise.all(
        prepared.map(async (file, i) => {
          const slot = presigned[i];
          const putRes = await fetch(slot.uploadUrl, {
            method: "PUT",
            headers: { "Content-Type": file.type },
            body: file,
          });
          if (!putRes.ok) {
            throw new Error(`Upload failed for ${file.name}`);
          }
        })
      );

      const res = await fetch(`/api/chat/threads/${threadId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body: trimmed || undefined,
          confirmed: confirmedSend,
          attachments: presigned.map((slot) => ({
            key: slot.key,
            fileName: slot.fileName,
            contentType: slot.contentType,
            sizeBytes: slot.sizeBytes,
          })),
        }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => null);
        trackEvent("chat_message_rejected", {
          threadId,
          reason: sendRejectionKind(res.status),
          hasAttachments: true,
        });
        throw rejectionError(errBody, `Failed to send (${res.status})`);
      }
      trackEvent("chat_message_sent", {
        threadId,
        hasAttachments: true,
        attachmentCount: presigned.length,
      });
      const data = await res.json();
      const confirmed = {
        ...optimistic,
        id: data.messageId,
        // Keep local previews until Realtime/history replaces metadata with real ids.
        metadata: {
          ...optimistic.metadata,
          pendingMessageId: data.messageId,
        },
      };
      setMessagesByThread((prev) => ({
        ...prev,
        [threadId]: replaceTempMessage(prev[threadId], tempId, confirmed),
      }));
      // Soft-refresh history so attachment ids (for /api/chat/attachments/…) land.
      loadMessages(threadId).catch(() => {});
      refreshThreads().catch(() => {});
      return confirmed;
    } catch (err) {
      localPreviews.forEach((p) => {
        if (p.localUrl) URL.revokeObjectURL(p.localUrl);
      });
      setMessagesByThread((prev) => ({
        ...prev,
        [threadId]: (prev[threadId] ?? []).filter((m) => m.id !== tempId),
      }));
      throw err;
    }
  }, [refreshThreads, loadMessages]);

  const startListingChat = useCallback(
    async (listingId, body, leaseId = null, options = {}) => {
      if (!userIdRef.current) throw new Error("Not signed in");
      if (viewAsRef.current) throw new Error(VIEW_AS_READ_ONLY_MESSAGE);
      const trimmed = typeof body === "string" ? body.trim() : "";
      if (!trimmed) throw new Error("Message body required");

      // leaseId decides the recipient on a property with competing leases.
      const res = await fetch("/api/chat/threads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          listingId,
          body: trimmed,
          leaseId,
          confirmed: options?.confirmed === true,
        }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => null);
        trackEvent("chat_start_rejected", {
          listingId,
          reason: sendRejectionKind(res.status),
        });
        if (errBody?.code === "PASSWORD_REQUIRED") setNeedsPassword(true);
        throw rejectionError(errBody, `Failed to start chat (${res.status})`);
      }
      const data = await res.json();
      trackEvent("chat_conversation_started", {
        listingId,
        newThread: Boolean(data?.isNew),
        newListingContext: Boolean(data?.isNewListing),
      });
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
    // Switching between your own inbox and someone else's starts clean, so
    // nothing of one shows in the other.
    if (lastViewAsRef.current !== viewAs) {
      if (lastViewAsRef.current !== undefined) clearChatState();
      lastViewAsRef.current = viewAs;
    }
    setInboxFor(viewAs ?? null);

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
  }, [userId, viewAs, sessionStatus, clearChatState, refreshThreads]);

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

    if (String(threadKindRef.current.get(activeThreadId) ?? "").startsWith("proxy")) {
      if (threadUnsubscribeRef.current) {
        threadUnsubscribeRef.current();
        threadUnsubscribeRef.current = null;
      }
      markThreadRead(activeThreadId).catch(() => {});
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

    /*
     * The open conversation also checks for new messages every few seconds
     * while it is on screen, so a new message always shows even when the live
     * channel is down (Wyatt, 2026-11-02). Already-shown messages are merged,
     * not repeated.
     */
    const poll = setInterval(() => {
      if (cancelled || document.visibilityState !== "visible") return;
      loadMessages(activeThreadId).catch(() => {});
    }, LIVE_POLL_MS);

    threadUnsubscribeRef.current = () => {
      clearInterval(poll);
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

  // The inbox (new conversations, unread badges) catches up on its own too.
  useEffect(() => {
    if (!userId) return;
    const t = setInterval(() => {
      if (document.visibilityState === "visible") refreshThreads().catch(() => {});
    }, INBOX_POLL_MS);
    return () => clearInterval(t);
  }, [userId, refreshThreads]);

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
    // A landlord answered Proxy or picked a tour time somewhere on the page:
    // the inbox's Proxy rows and unread badge catch up (Wyatt, 2026-11-01).
    const offLandlord = onLandlordChange(() => refreshThreads().catch(() => {}));
    const offInbox = onInboxChange(() => refreshThreads().catch(() => {}));
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      offLandlord();
      offInbox();
    };
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
      startListingChat,
      markThreadRead,
      setActiveThreadId,
      needsPassword,
      clearNeedsPassword: () => setNeedsPassword(false),
      viewAs,
      readOnly: !!viewAs,
      setViewAs: setViewAsState,
      inboxFor,
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
      startListingChat,
      markThreadRead,
      needsPassword,
      viewAs,
      inboxFor,
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
