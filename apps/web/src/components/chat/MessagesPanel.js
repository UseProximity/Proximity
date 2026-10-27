/*
 * Shared messenger UI: inbox + transcript (desktop split / mobile stack).
 * Rendered inside GlobalMessagesPanel, which owns the "Messages" title bar and
 * close button, so there is no header here. Data/actions come from useMessages().
 *
 * Two tabs (Wyatt, 2026-10-27): Landlords, the direct conversations, shown
 * only once there is at least one; and Proxy, the student's conversations
 * with the assistant on each listing, which open in ProxyThread.
 */
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useMessages } from "@/context/MessagesContext";
import ChatThreadList from "@/components/chat/ChatThreadList";
import ChatTranscript from "@/components/chat/ChatTranscript";
import ProxyThread from "@/components/chat/ProxyThread";

/**
 * @param {{ onBrowse?: () => void, className?: string }} [props]
 */
export default function MessagesPanel({ onBrowse, className = "" }) {
  const {
    threads,
    threadsStatus,
    threadsLoading,
    messagesByThread,
    messagesStatusByThread,
    activeThreadId,
    setActiveThreadId,
    sendMessage,
    refreshThreads,
    prefetchMessages,
  } = useMessages();

  const activeThread = useMemo(
    () => threads.find((t) => t.threadId === activeThreadId) ?? null,
    [threads, activeThreadId]
  );
  const direct = useMemo(() => threads.filter((t) => t.kind !== "proxy"), [threads]);
  const proxy = useMemo(() => threads.filter((t) => t.kind === "proxy"), [threads]);
  const showLandlords = direct.length > 0;
  const [tab, setTab] = useState("landlords");
  // The Landlords tab exists only with a landlord conversation; an open
  // thread pulls its own tab forward (a deep link from an email).
  useEffect(() => {
    if (!showLandlords && tab === "landlords" && proxy.length > 0) setTab("proxy");
  }, [showLandlords, proxy.length, tab]);
  useEffect(() => {
    if (activeThread) setTab(activeThread.kind === "proxy" ? "proxy" : "landlords");
  }, [activeThread]);
  const shownThreads = tab === "proxy" ? proxy : direct;
  const unreadIn = (list) => list.reduce((n, t) => n + (typeof t.unreadCount === "number" ? t.unreadCount : t.hasUnread ? 1 : 0), 0);

  const activeMessages = activeThreadId
    ? messagesByThread[activeThreadId]
    : undefined;
  const activeMessagesStatus = activeThreadId
    ? messagesStatusByThread[activeThreadId]
    : undefined;
  const messagesLoading =
    !!activeThreadId &&
    (activeMessagesStatus === "loading" ||
      (activeMessagesStatus == null && activeMessages == null));

  const openThread = useCallback(
    (threadId) => {
      if (!threadId) return;
      prefetchMessages(threadId);
      setActiveThreadId(threadId);
    },
    [prefetchMessages, setActiveThreadId]
  );

  const backToList = useCallback(() => {
    setActiveThreadId(null);
  }, [setActiveThreadId]);

  const retryInbox = useCallback(() => {
    refreshThreads().catch(() => {});
  }, [refreshThreads]);

  const tabButton = (key, label, count) => (
    <button
      type="button"
      onClick={() => setTab(key)}
      className={`flex-1 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${tab === key ? "border-red-600 text-gray-900" : "border-transparent text-gray-500 hover:text-gray-700"}`}
    >
      {label}
      {count > 0 && <span className="ml-1.5 rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-bold text-white">{count > 99 ? "99+" : count}</span>}
    </button>
  );
  const tabs = (showLandlords || proxy.length > 0) ? (
    <div className="flex border-b border-gray-100">
      {showLandlords && tabButton("landlords", "Landlords", unreadIn(direct))}
      {tabButton("proxy", "Proxy", unreadIn(proxy))}
    </div>
  ) : null;

  const listProps = {
    threads: shownThreads,
    activeThreadId,
    onSelect: openThread,
    onPrefetch: prefetchMessages,
    onBrowse,
    loading: threadsLoading,
    error: threadsStatus === "error",
    onRetry: retryInbox,
    tabs,
    emptyMessage: tab === "proxy"
      ? "No Proxy conversations yet. Ask Proxy anything about a listing from its Contact tab."
      : "No conversations yet. Message a landlord from a listing to get started.",
  };

  const transcript = (onBack) =>
    activeThread?.kind === "proxy" ? (
      <ProxyThread thread={activeThread} onBack={onBack} />
    ) : (
      <ChatTranscript
        thread={activeThread}
        messages={activeMessages}
        messagesLoading={messagesLoading}
        onSend={sendMessage}
        onBack={onBack}
      />
    );

  const showEmptyTranscript =
    !threadsLoading && threadsStatus !== "error" && threads.length === 0;


  return (
    <div
      className={`flex flex-col h-full min-h-0 bg-white overflow-hidden ${className}`}
    >
      <div className="flex-1 min-h-0 flex">
        <div className="hidden md:flex w-[340px] flex-shrink-0 border-r border-gray-100 flex-col min-h-0">
          <ChatThreadList {...listProps} />
        </div>
        <div className="flex-1 min-w-0 min-h-0 flex flex-col md:hidden">
          {activeThreadId ? transcript(backToList) : <ChatThreadList {...listProps} />}
        </div>
        <div className="hidden md:flex flex-1 min-w-0 min-h-0 flex-col">
          {activeThreadId ? transcript(null) : (
            <div className="flex flex-1 items-center justify-center text-sm text-gray-400 px-6 text-center">
              {showEmptyTranscript
                ? "No conversations yet."
                : threadsLoading || threadsStatus === "error"
                  ? null
                  : "Select a conversation to start messaging."}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
