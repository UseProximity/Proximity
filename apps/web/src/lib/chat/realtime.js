/*
 * Supabase Realtime helper for listing chat.
 *
 * Writes/history stay on /api/chat/*. This module only pushes new chat_messages
 * INSERTs into an open thread. Token lifecycle: fetch → setAuth → subscribe; on
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
 * Subscribe to INSERT events on chat_messages for one thread.
 * Returns an unsubscribe function.
 *
 * @param {string} threadId
 * @param {(message: object) => void} onInsert — camelCase message matching the API
 * @param {{ currentUserId?: string, onStatus?: (status: string, err?: Error) => void }} [options]
 */
export function subscribeThreadMessages(threadId, onInsert, options = {}) {
  const { currentUserId, onStatus } = options;
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
        .channel(`chat-thread:${threadId}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "chat_messages",
            filter: `thread_id=eq.${threadId}`,
          },
          (payload) => {
            const mapped = mapRealtimeMessage(payload?.new, currentUserId);
            if (mapped) onInsert(mapped);
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
