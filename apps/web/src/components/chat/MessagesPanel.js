/*
 * Shared messenger UI: inbox + transcript (desktop split / mobile stack).
 * Used by the /messages page. Data/actions come from useMessages().
 */
"use client";

import { useCallback, useMemo } from "react";
import { useMessages } from "@/context/MessagesContext";
import ChatThreadList from "@/components/chat/ChatThreadList";
import ChatTranscript from "@/components/chat/ChatTranscript";

/**
 * @param {{ headerActions?: import('react').ReactNode, onBrowse?: () => void, className?: string }} [props]
 */
export default function MessagesPanel({
  headerActions = null,
  onBrowse,
  className = "",
}) {
  const {
    threads,
    messagesByThread,
    activeThreadId,
    setActiveThreadId,
    sendMessage,
    markThreadRead,
  } = useMessages();

  const activeThread = useMemo(
    () => threads.find((t) => t.threadId === activeThreadId) ?? null,
    [threads, activeThreadId]
  );

  const openThread = useCallback(
    (threadId) => {
      if (!threadId) return;
      setActiveThreadId(threadId);
      markThreadRead(threadId).catch(() => {});
    },
    [setActiveThreadId, markThreadRead]
  );

  const backToList = useCallback(() => {
    setActiveThreadId(null);
  }, [setActiveThreadId]);

  const listProps = {
    threads,
    activeThreadId,
    onSelect: openThread,
    onBrowse,
  };

  return (
    <div
      className={`flex flex-col h-full min-h-0 bg-white overflow-hidden ${className}`}
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 flex-shrink-0">
        <h1 className="text-base font-bold text-gray-900">Messages</h1>
        {headerActions ? (
          <div className="flex items-center gap-0.5">{headerActions}</div>
        ) : null}
      </div>
      <div className="flex-1 min-h-0 flex">
        <div className="hidden md:flex w-[340px] flex-shrink-0 border-r border-gray-100 flex-col min-h-0">
          <ChatThreadList {...listProps} />
        </div>
        <div className="flex-1 min-h-0 flex flex-col md:hidden">
          {activeThreadId ? (
            <ChatTranscript
              thread={activeThread}
              messages={messagesByThread[activeThreadId]}
              onSend={sendMessage}
              onBack={backToList}
            />
          ) : (
            <ChatThreadList {...listProps} />
          )}
        </div>
        <div className="hidden md:flex flex-1 min-h-0 flex-col">
          {activeThreadId ? (
            <ChatTranscript
              thread={activeThread}
              messages={messagesByThread[activeThreadId]}
              onSend={sendMessage}
              onBack={null}
            />
          ) : threads.length === 0 ? (
            <ChatThreadList {...listProps} />
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-gray-400 px-6 text-center">
              Select a conversation to start messaging.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
