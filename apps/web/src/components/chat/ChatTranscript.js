"use client";

import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import ChatAvatar from "@/components/chat/ChatAvatar";

const MAX_BODY = 5000;
const WARN_AT = 4500;

/**
 * Message bubbles + composer for one thread (useMessages messages + sendMessage).
 */
export default function ChatTranscript({
  thread,
  messages,
  onSend,
  onBack,
  headerActions = null,
}) {
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef(null);
  const list = messages ?? [];
  const lastMessageId = list.length ? list[list.length - 1].id : null;
  const nearLimit = input.length >= WARN_AT;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [list.length, lastMessageId]);

  async function handleSend() {
    const text = input.trim();
    if (!text || sending || !thread?.threadId) return;
    setSending(true);
    setInput("");
    try {
      await onSend(thread.threadId, text);
    } catch (err) {
      setInput(text);
      toast.error(err?.message || "Failed to send message. Please try again.");
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-2 px-3 py-3 border-b border-gray-100 flex-shrink-0">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="p-1.5 rounded-full hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors flex-shrink-0"
            aria-label="Back to inbox"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.5}
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15.75 19.5L8.25 12l7.5-7.5"
              />
            </svg>
          </button>
        )}
        <ChatAvatar
          src={thread?.otherUserImage}
          name={thread?.otherUserName}
          size="sm"
        />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900 truncate">
            {thread?.otherUserName || "Conversation"}
          </p>
          {(thread?.listingTitle || thread?.listingAddress) && (
            <p className="text-xs text-gray-400 truncate">
              {thread.listingTitle || thread.listingAddress}
            </p>
          )}
        </div>
        {headerActions}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2 min-h-0">
        {list.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">
            No messages yet. Say hello!
          </p>
        ) : (
          list.map((msg) => (
            <div
              key={msg.id}
              className={`flex items-end gap-2 ${
                msg.isMine ? "flex-row-reverse" : "flex-row"
              }`}
            >
              {!msg.isMine && (
                <ChatAvatar
                  src={thread?.otherUserImage}
                  name={thread?.otherUserName}
                  size="sm"
                />
              )}
              <div
                className={`max-w-[72%] px-3 py-2 rounded-2xl text-sm leading-snug whitespace-pre-wrap break-words ${
                  msg.isMine
                    ? "bg-red-600 text-white rounded-br-sm"
                    : "bg-gray-100 text-gray-800 rounded-bl-sm"
                } ${String(msg.id).startsWith("temp-") ? "opacity-70" : ""}`}
              >
                {msg.body}
              </div>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      <div className="px-3 pb-3 pt-2 border-t border-gray-100 flex-shrink-0">
        <div
          className={`flex items-end gap-2 bg-gray-50 rounded-xl border px-3 py-2 ${
            sending ? "border-gray-200 opacity-80" : "border-gray-200"
          }`}
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value.slice(0, MAX_BODY))}
            onKeyDown={handleKeyDown}
            rows={1}
            disabled={sending}
            placeholder={sending ? "Sending…" : "Type a message..."}
            aria-busy={sending}
            className="flex-1 bg-transparent text-sm text-gray-800 placeholder-gray-400 outline-none resize-none max-h-24 py-1.5 disabled:cursor-not-allowed"
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={!input.trim() || sending}
            className="w-8 h-8 rounded-full bg-red-600 hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed text-white flex items-center justify-center transition-colors flex-shrink-0 mb-0.5"
            aria-label="Send message"
          >
            {sending ? (
              <svg
                className="w-4 h-4 animate-spin"
                fill="none"
                viewBox="0 0 24 24"
                aria-hidden
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                />
              </svg>
            ) : (
              <svg
                className="w-4 h-4 translate-x-px"
                fill="currentColor"
                viewBox="0 0 24 24"
              >
                <path d="M3.478 2.405a.75.75 0 00-.926.94l2.432 7.905H13.5a.75.75 0 010 1.5H4.984l-2.432 7.905a.75.75 0 00.926.94 60.519 60.519 0 0018.445-8.986.75.75 0 000-1.218A60.517 60.517 0 003.478 2.405z" />
              </svg>
            )}
          </button>
        </div>
        {nearLimit && (
          <p
            className={`mt-1.5 text-[11px] text-right ${
              input.length >= MAX_BODY ? "text-red-600 font-medium" : "text-gray-400"
            }`}
          >
            {input.length}/{MAX_BODY}
          </p>
        )}
      </div>
    </div>
  );
}
