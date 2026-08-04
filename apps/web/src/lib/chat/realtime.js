/*
 * Supabase Realtime helper for listing chat.
 *
 * Writes/history stay on /api/chat/*. This module pushes new chat_messages
 * INSERTs: thread-scoped (open chat bubbles) and inbox-wide (badge / preview
 * via refreshThreads). Token lifecycle: fetch → setAuth → subscribe; on
 * channel/auth failure, remove channel, mint a fresh token, and resubscribe.
 * No proactive refresh-before-expiry loop.
 */
import { createClient } from "@/lib/supabase/client";

let authInFlight = null;

function getBrowserClient() {
  return createClient();
}

/** Map a Realtime postgres row to the same camelCase shape as rpc_get_chat_messages. */
export function mapRealtimeMessage(row, currentUserId) {
  if (!row) return null;
  return {
    id: row.id,
    threadId: row.thread_id,
    senderId: row.sender_id,
    isMine: currentUserId ? row.sender_id === currentUserId : undefined,
    body: row.body,
    messageType: row.message_type,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
  };
}

/**
 * Mint a short-lived Supabase JWT and attach it to the browser Realtime client.
 * Concurrent callers share one in-flight request.
 */
export async function ensureRealtimeAuth() {
  if (authInFlight) return authInFlight;

  authInFlight = (async () => {
    const res = await fetch("/api/chat/realtime-token");
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(
        body?.error || `realtime-token failed (${res.status})`
      );
    }
    const { accessToken } = await res.json();
    if (!accessToken) {
      throw new Error("realtime-token response missing accessToken");
    }
    const client = getBrowserClient();
    client.realtime.setAuth(accessToken);
    return client;
  })();

  try {
    return await authInFlight;
  } finally {
    authInFlight = null;
  }
}

/**
 * Shared INSERT subscription on chat_messages.
 * @param {{ channelName: string, filter?: string, currentUserId?: string, onInsert: (message: object) => void, onStatus?: (status: string, err?: Error) => void }} opts
 */
function subscribeChatMessageInserts({
  channelName,
  filter,
  currentUserId,
  onInsert,
  onStatus,
}) {
  let disposed = false;
  let client = null;
  let channel = null;
  let reconnectAttempt = 0;
  let reconnectTimer = null;

  function clearReconnect() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  async function teardownChannel() {
    if (client && channel) {
      try {
        await client.removeChannel(channel);
      } catch {
        // ignore teardown races
      }
    }
    channel = null;
  }

  function scheduleReconnect() {
    if (disposed || reconnectTimer) return;
    const delayMs = Math.min(1000 * 2 ** reconnectAttempt, 15000);
    reconnectAttempt += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delayMs);
  }

  async function connect() {
    if (disposed) return;

    try {
      await teardownChannel();
      client = await ensureRealtimeAuth();
      if (disposed) return;

      const changeFilter = {
        event: "INSERT",
        schema: "public",
        table: "chat_messages",
      };
      if (filter) changeFilter.filter = filter;

      channel = client
        .channel(channelName)
        .on("postgres_changes", changeFilter, (payload) => {
          const mapped = mapRealtimeMessage(payload?.new, currentUserId);
          if (mapped) onInsert(mapped);
        })
        .subscribe((status, err) => {
          onStatus?.(status, err);
          if (disposed) return;
          if (status === "SUBSCRIBED") {
            reconnectAttempt = 0;
            return;
          }
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            scheduleReconnect();
          }
        });
    } catch (err) {
      onStatus?.("AUTH_ERROR", err instanceof Error ? err : new Error(String(err)));
      if (!disposed) scheduleReconnect();
    }
  }

  connect();

  return () => {
    disposed = true;
    clearReconnect();
    teardownChannel();
  };
}

/**
 * Subscribe to INSERT events on chat_messages for one thread.
 * Returns an unsubscribe function.
 *
 * @param {string} threadId
 * @param {(message: object) => void} onInsert — camelCase message matching the API
 * @param {{ currentUserId?: string, onStatus?: (status: string, err?: Error) => void }} [options]
 */
export function subscribeThreadMessages(threadId, onInsert, options = {}) {
  const { currentUserId, onStatus } = options;
  return subscribeChatMessageInserts({
    channelName: `chat-thread:${threadId}`,
    filter: `thread_id=eq.${threadId}`,
    currentUserId,
    onInsert,
    onStatus,
  });
}

/**
 * Subscribe to INSERT events on chat_messages across all threads the JWT
 * user can SELECT (RLS). Used to refresh inbox badge / previews.
 * Returns an unsubscribe function.
 *
 * @param {(message: object) => void} onInsert
 * @param {{ currentUserId?: string, onStatus?: (status: string, err?: Error) => void }} [options]
 */
export function subscribeInboxMessages(onInsert, options = {}) {
  const { currentUserId, onStatus } = options;
  return subscribeChatMessageInserts({
    channelName: "chat-inbox",
    currentUserId,
    onInsert,
    onStatus,
  });
}

/**
 * Subscribe to chat_participants UPDATEs for one thread (other user's last_read_at).
 * Powers live "Read · time" receipts while a conversation is open.
 *
 * @param {string} threadId
 * @param {(payload: { userId: string, lastReadAt: string | null }) => void} onUpdate
 * @param {{ onStatus?: (status: string, err?: Error) => void }} [options]
 */
export function subscribeThreadReadReceipts(threadId, onUpdate, options = {}) {
  const { onStatus } = options;
  let disposed = false;
  let client = null;
  let channel = null;
  let reconnectAttempt = 0;
  let reconnectTimer = null;

  function clearReconnect() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  async function teardownChannel() {
    if (client && channel) {
      try {
        await client.removeChannel(channel);
      } catch {
        // ignore teardown races
      }
    }
    channel = null;
  }

  function scheduleReconnect() {
    if (disposed || reconnectTimer) return;
    const delayMs = Math.min(1000 * 2 ** reconnectAttempt, 15000);
    reconnectAttempt += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delayMs);
  }

  async function connect() {
    if (disposed) return;

    try {
      await teardownChannel();
      client = await ensureRealtimeAuth();
      if (disposed) return;

      channel = client
        .channel(`chat-thread-read:${threadId}`)
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "chat_participants",
            filter: `thread_id=eq.${threadId}`,
          },
          (payload) => {
            const row = payload?.new;
            if (!row?.user_id) return;
            onUpdate({
              userId: row.user_id,
              lastReadAt: row.last_read_at ?? null,
            });
          }
        )
        .subscribe((status, err) => {
          onStatus?.(status, err);
          if (disposed) return;
          if (status === "SUBSCRIBED") {
            reconnectAttempt = 0;
            return;
          }
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            scheduleReconnect();
          }
        });
    } catch (err) {
      onStatus?.(
        "AUTH_ERROR",
        err instanceof Error ? err : new Error(String(err))
      );
      if (!disposed) scheduleReconnect();
    }
  }

  connect();

  return () => {
    disposed = true;
    clearReconnect();
    teardownChannel();
  };
}
