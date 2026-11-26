// Realtime for in-app chat. One shared Supabase Realtime socket for the signed-in
// user, used only to hear that a chat_messages row was inserted. The REST routes
// stay the source of truth: an event is a nudge to merge or refetch, never a
// replacement for the API, and who may see what is decided by the database's row
// level security (the token below carries the user's id), not by this file.
//
// Auth: the socket authenticates with the short-lived Supabase JWT from
// GET /api/chat/realtime-token (apiClient.chat.getRealtimeToken). It lives for an
// hour, so the manager caches it, hands it to the client through the
// `accessToken` callback, and re-pushes a fresh one to the joined channels before
// it expires (client.setAuth() with no argument re-reads the callback).
//
// Lifecycle:
//   startChatRealtime(userId) / stopChatRealtime()  sign-in / sign-out
//   subscribeInbox(handlers)                         every message the user may see
//   subscribeThread(threadId, handlers)              one conversation
// Subscriptions may be registered before start (screens mount before the tab
// layout's effect runs) and attach once the manager is started and the app is in
// the foreground. When the app is backgrounded the socket is closed (iOS drops it
// anyway); on return everything reattaches and each subscription's `onSubscribed`
// fires again, which is the cue for the screen to refetch what it missed.
import { AppState } from "react-native";
import { RealtimeClient } from "@supabase/realtime-js";
import apiClient from "./apiClient";

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.EXPO_PUBLIC_SUPABASE_DEFAULT_KEY;

// Push a fresh token to the channels this long before the current one expires.
const REFRESH_MARGIN_MS = 5 * 60 * 1000;
// A cached token with less than this left is treated as already expired.
const MIN_VALID_MS = 60 * 1000;
const RETRY_BASE_MS = 1000;
const RETRY_MAX_MS = 15000;

let started = false;
let currentUserId = null;
let paused = AppState.currentState !== "active";
let client = null;
let token = null; // { accessToken, expiresAtMs }
let tokenRequest = null;
let refreshTimer = null;
let appStateSubscription = null;
let nextSubscriptionId = 1;
const subscriptions = new Map();

export function isChatRealtimeConfigured() {
  return !!(SUPABASE_URL && SUPABASE_KEY);
}

// Same camelCase shape as rpc_get_chat_messages. The realtime payload is the raw
// chat_messages row, so it has no listing title or address; callers refetch when
// they need those.
export function mapRealtimeMessage(row) {
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
    listingId: row.listing_id ?? null,
  };
}

// ---------------------------------------------------------------- token

function tokenIsFresh(minRemainingMs) {
  return !!token && token.expiresAtMs - Date.now() > minRemainingMs;
}

async function fetchToken() {
  if (tokenRequest) return tokenRequest;
  tokenRequest = (async () => {
    try {
      const { accessToken, expiresAt } = await apiClient.chat.getRealtimeToken();
      if (!accessToken) throw new Error("realtime-token response missing accessToken");
      // The route reports expiry in epoch seconds.
      token = { accessToken, expiresAtMs: Number(expiresAt) * 1000 || Date.now() + 55 * 60 * 1000 };
      return token.accessToken;
    } finally {
      tokenRequest = null;
    }
  })();
  return tokenRequest;
}

async function getAccessToken() {
  if (tokenIsFresh(MIN_VALID_MS)) return token.accessToken;
  return fetchToken();
}

function scheduleTokenRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = null;
  if (!client || !token) return;
  const delay = Math.max(token.expiresAtMs - Date.now() - REFRESH_MARGIN_MS, 5000);
  refreshTimer = setTimeout(async () => {
    refreshTimer = null;
    const activeClient = client;
    if (!activeClient) return;
    try {
      await fetchToken();
      // No argument: re-reads the accessToken callback and pushes the new JWT to
      // every joined channel, so live subscriptions never see an expired token.
      await activeClient.setAuth();
    } catch {
      // Leave it: an expiry error on a channel is retried with a fresh token below.
    }
    if (client === activeClient) scheduleTokenRefresh();
  }, delay);
}

// --------------------------------------------------------------- client

function realtimeEndpoint() {
  return `${SUPABASE_URL.replace(/\/$/, "").replace(/^http/, "ws")}/realtime/v1`;
}

function ensureClient() {
  if (client) return client;
  client = new RealtimeClient(realtimeEndpoint(), {
    params: { apikey: SUPABASE_KEY },
    accessToken: getAccessToken,
  });
  client.connect();
  return client;
}

function closeClient() {
  clearTimeout(refreshTimer);
  refreshTimer = null;
  const closing = client;
  client = null;
  if (closing) {
    Promise.resolve(closing.disconnect()).catch(() => {});
  }
}

// -------------------------------------------------------- subscriptions

function canAttach() {
  return started && !paused && isChatRealtimeConfigured();
}

function detach(sub) {
  clearTimeout(sub.retryTimer);
  sub.retryTimer = null;
  sub.generation += 1;
  const channel = sub.channel;
  sub.channel = null;
  if (channel && client) {
    Promise.resolve(client.removeChannel(channel)).catch(() => {});
  }
}

function scheduleRetry(sub) {
  if (sub.disposed || sub.retryTimer || !canAttach()) return;
  const delay = Math.min(RETRY_BASE_MS * 2 ** sub.attempt, RETRY_MAX_MS);
  sub.attempt += 1;
  sub.retryTimer = setTimeout(() => {
    sub.retryTimer = null;
    attach(sub);
  }, delay);
}

async function attach(sub) {
  if (sub.disposed || !canAttach()) return;
  detach(sub);
  const generation = sub.generation;

  try {
    // Fetch the token up front so the join carries it and a token failure is a
    // retry here rather than a confusing channel error later.
    await getAccessToken();
    if (sub.disposed || sub.generation !== generation || !canAttach()) return;

    const activeClient = ensureClient();
    // Load the token into the client before joining, so the join itself is
    // authenticated as the user instead of waiting for the connect-time callback.
    await activeClient.setAuth();
    if (sub.disposed || sub.generation !== generation || !canAttach()) return;
    scheduleTokenRefresh();

    const change = { event: "INSERT", schema: "public", table: "chat_messages" };
    if (sub.filter) change.filter = sub.filter;

    const channel = activeClient
      .channel(sub.channelName)
      .on("postgres_changes", change, (payload) => {
        if (sub.disposed || sub.generation !== generation) return;
        const message = mapRealtimeMessage(payload?.new);
        if (message) sub.handlers.onInsert?.(message);
      })
      .subscribe((status) => {
        if (sub.disposed || sub.generation !== generation) return;
        if (status === "SUBSCRIBED") {
          sub.attempt = 0;
          sub.handlers.onSubscribed?.();
          return;
        }
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          // Rebuild the channel (and, if the token expired, mint a new one).
          scheduleRetry(sub);
        }
      });
    sub.channel = channel;
  } catch {
    if (!sub.disposed && sub.generation === generation) scheduleRetry(sub);
  }
}

function register(channelName, filter, handlers) {
  const sub = {
    id: nextSubscriptionId++,
    channelName,
    filter,
    handlers: handlers ?? {},
    channel: null,
    retryTimer: null,
    attempt: 0,
    generation: 0,
    disposed: false,
  };
  subscriptions.set(sub.id, sub);
  attach(sub);

  return () => {
    if (sub.disposed) return;
    sub.disposed = true;
    detach(sub);
    subscriptions.delete(sub.id);
    if (subscriptions.size === 0) closeClient();
  };
}

// Every INSERT on chat_messages the user is allowed to see (row level security
// narrows it to their threads).
export function subscribeInbox(handlers) {
  return register("chat-inbox", null, handlers);
}

export function subscribeThread(threadId, handlers) {
  return register(`chat-thread:${threadId}`, `thread_id=eq.${threadId}`, handlers);
}

// ------------------------------------------------------------ lifecycle

function pause() {
  if (paused) return;
  paused = true;
  subscriptions.forEach((sub) => detach(sub));
  closeClient();
}

function resume() {
  if (!paused) return;
  paused = false;
  if (!started) return;
  subscriptions.forEach((sub) => attach(sub));
}

function onAppStateChange(state) {
  if (state === "active") resume();
  else if (state === "background") pause();
}

// Call when the signed-in user is known. Safe to call again with the same id.
export function startChatRealtime(userId) {
  if (!userId) return;
  if (started && currentUserId === userId) return;
  if (started) stopChatRealtime();

  started = true;
  currentUserId = userId;
  paused = AppState.currentState !== "active";
  appStateSubscription = AppState.addEventListener("change", onAppStateChange);
  if (!paused) subscriptions.forEach((sub) => attach(sub));
}

// Call on sign-out. Closes the socket, forgets the token and drops every
// subscription, so the next user starts from nothing.
export function stopChatRealtime() {
  appStateSubscription?.remove();
  appStateSubscription = null;
  started = false;
  currentUserId = null;
  token = null;
  tokenRequest = null;
  subscriptions.forEach((sub) => {
    sub.disposed = true;
    detach(sub);
  });
  subscriptions.clear();
  closeClient();
}
