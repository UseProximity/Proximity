/*
 * Messenger panel opened from the header (and later listing Message CTA) via
 * openMessages() / proximity:open-messages. Uses MessagesContext for data;
 * local chrome for open + compact/expanded. No floating FAB — nav is the entry.
 *
 * z-index: under sticky Header (z-50) and under listing/feedback modals (z-60);
 * above page chrome / dashboard sidebar (z-40). Expanded shell uses
 * pointer-events-none so the header band stays clickable.
 */
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { Maximize2, Minimize2, X } from "lucide-react";
import { useMessages } from "@/context/MessagesContext";
import ChatThreadList from "@/components/chat/ChatThreadList";
import ChatTranscript from "@/components/chat/ChatTranscript";
import { OPEN_MESSAGES_EVENT } from "@/components/chat/chatEvents";

function PanelIconButton({ onClick, label, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="p-1.5 rounded-full hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
      aria-label={label}
    >
      {children}
    </button>
  );
}

export default function ChatWidget() {
  const { data: session } = useSession();
  const userId = session?.user?.id ?? null;

  const {
    threads,
    messagesByThread,
    activeThreadId,
    setActiveThreadId,
    sendMessage,
    markThreadRead,
  } = useMessages();

  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(true);

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

  const closePanel = useCallback(() => {
    setOpen(false);
    setExpanded(true);
    setActiveThreadId(null);
  }, [setActiveThreadId]);

  useEffect(() => {
    function onOpen(e) {
      if (!userId) return;
      const detail = e?.detail ?? {};
      setOpen(true);
      // Default to full-page under nav; callers can pass expanded:false for compact.
      setExpanded(detail.expanded !== false);
      if (detail.threadId) {
        openThread(detail.threadId);
      }
    }
    window.addEventListener(OPEN_MESSAGES_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_MESSAGES_EVENT, onOpen);
  }, [userId, openThread]);

  // Escape closes the messenger.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e) {
      if (e.key === "Escape") closePanel();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, closePanel]);

  // Lock page scroll while expanded (same pattern as ModalListing).
  useEffect(() => {
    if (!open || !expanded) return;
    const scrollY = window.scrollY;
    const prevOverflow = document.body.style.overflow;
    const prevPosition = document.body.style.position;
    const prevTop = document.body.style.top;
    const prevWidth = document.body.style.width;
    document.body.style.overflow = "hidden";
    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = "100%";
    return () => {
      document.body.style.overflow = prevOverflow;
      document.body.style.position = prevPosition;
      document.body.style.top = prevTop;
      document.body.style.width = prevWidth;
      window.scrollTo(0, scrollY);
    };
  }, [open, expanded]);

  if (!userId || !open) return null;

  const chromeActions = (
    <>
      <PanelIconButton
        onClick={() => setExpanded((v) => !v)}
        label={expanded ? "Collapse messages" : "Expand messages"}
      >
        {expanded ? (
          <Minimize2 className="w-4 h-4" />
        ) : (
          <Maximize2 className="w-4 h-4" />
        )}
      </PanelIconButton>
      <PanelIconButton onClick={closePanel} label="Close messages">
        <X className="w-4 h-4" />
      </PanelIconButton>
    </>
  );

  const listProps = {
    threads,
    activeThreadId,
    onSelect: openThread,
    onBrowse: closePanel,
  };

  const compactBody = activeThreadId ? (
    <ChatTranscript
      thread={activeThread}
      messages={messagesByThread[activeThreadId]}
      onSend={sendMessage}
      onBack={backToList}
      headerActions={<div className="flex items-center gap-0.5">{chromeActions}</div>}
    />
  ) : (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 flex-shrink-0">
        <h2 className="text-base font-bold text-gray-900">Messages</h2>
        <div className="flex items-center gap-0.5">{chromeActions}</div>
      </div>
      <ChatThreadList {...listProps} />
    </div>
  );

  return (
    <>
      {/* Compact: above page (z-40), below header (50) and listing modal (60). */}
      {!expanded && (
        <div
          className="fixed z-[45] bottom-6 right-4 sm:right-8 w-[min(100vw-2rem,380px)] h-[min(70vh,560px)] flex flex-col bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden"
          role="dialog"
          aria-label="Messages"
        >
          {compactBody}
        </div>
      )}

      {/* Full page under sticky header (z-50). Listing/feedback modals stay above at z-60. */}
      {expanded && (
        <div
          className="fixed inset-0 z-[45] pt-[83px] md:pt-[104px] pointer-events-none"
          role="dialog"
          aria-label="Messages"
        >
          <div className="pointer-events-auto h-full w-full bg-white border-t border-gray-100 flex flex-col overflow-hidden shadow-none">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 flex-shrink-0">
              <h2 className="text-base font-bold text-gray-900">Messages</h2>
              <div className="flex items-center gap-0.5">{chromeActions}</div>
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
        </div>
      )}
    </>
  );
}
