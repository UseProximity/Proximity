"use client";

import { useEffect, useRef } from "react";
import MessageBubble from "./MessageBubble";

function TypingDots() {
  return (
    <div className="flex items-end gap-2">
      <div className="w-7 h-7 rounded-full bg-red-100 text-red-600 text-xs font-bold flex items-center justify-center flex-shrink-0">
        P
      </div>
      <div className="bg-gray-100 rounded-2xl rounded-bl-sm px-3 py-2.5 flex items-center gap-1">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce"
            style={{ animationDelay: `${i * 0.15}s` }}
          />
        ))}
      </div>
    </div>
  );
}

export default function ChatWindow({ messages, loading, onSend }) {
  const scrollRef = useRef(null);
  const lastMsgRef = useRef(null);
  const inputRef = useRef(null);

  // Scroll so the TOP of the newest message is visible; input stays pinned below
  useEffect(() => {
    if (lastMsgRef.current) {
      lastMsgRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    } else if (scrollRef.current) {
      // No messages yet (loading state) — scroll to top to show typing dots
      scrollRef.current.scrollTop = 0;
    }
  }, [messages.length, loading]);

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const text = e.target.value.trim();
      if (text && !loading) {
        onSend(text);
        e.target.value = "";
      }
    }
  };

  const handleSendClick = () => {
    const text = inputRef.current?.value.trim();
    if (text && !loading) {
      onSend(text);
      inputRef.current.value = "";
    }
  };

  return (
    // flex-1 fills the parent flex-col chat box; min-h-0 lets it shrink below content size
    <div className="flex-1 min-h-0 flex flex-col">

      {/* Scrollable message list — grows, shrinks, scrolls internally */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-3">
        {messages.length === 0 && loading && (
          <p className="text-xs text-gray-400 text-center pt-2">Proxy is starting up…</p>
        )}
        {messages.map((msg, i) => (
          <div
            key={i}
            ref={i === messages.length - 1 ? lastMsgRef : null}
          >
            <MessageBubble message={msg} />
          </div>
        ))}
        {loading && (
          <div ref={messages.length === 0 ? lastMsgRef : null}>
            <TypingDots />
          </div>
        )}
      </div>

      {/* Composer — always visible, never scrolls away */}
      <div className="flex-shrink-0 border-t border-gray-100 px-4 pb-4 pt-3">
        <div className="flex items-center gap-2 bg-gray-50 rounded-xl border border-gray-200 px-3 py-2">
          <input
            ref={inputRef}
            type="text"
            onKeyDown={handleKeyDown}
            placeholder="Type a message…"
            disabled={loading}
            className="flex-1 bg-transparent text-sm text-gray-800 placeholder-gray-400 outline-none disabled:opacity-50"
          />
          <button
            onClick={handleSendClick}
            disabled={loading}
            className="w-7 h-7 rounded-full bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white flex items-center justify-center transition flex-shrink-0"
          >
            <svg className="w-3.5 h-3.5 translate-x-px" fill="currentColor" viewBox="0 0 24 24">
              <path d="M3.478 2.405a.75.75 0 00-.926.94l2.432 7.905H13.5a.75.75 0 010 1.5H4.984l-2.432 7.905a.75.75 0 00.926.94 60.519 60.519 0 0018.445-8.986.75.75 0 000-1.218A60.517 60.517 0 003.478 2.405z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
