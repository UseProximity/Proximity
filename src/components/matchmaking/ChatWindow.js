"use client";

import { useCallback, useEffect, useRef } from "react";
import MessageBubble from "./MessageBubble";
import RecommendationCards from "./RecommendationCards";

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

export default function ChatWindow({ messages, loading, onSend, onAnswer, onEdit }) {
  const scrollRef = useRef(null);
  const lastMsgRef = useRef(null);
  const inputRef = useRef(null);

  // Scroll the chat container ONLY (never the page) so the top of the newest
  // message is visible. Using scrollIntoView here would bubble up and scroll the
  // whole page; instead we adjust this container's own scrollTop.
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const el = lastMsgRef.current;
    if (el) {
      const delta = el.getBoundingClientRect().top - container.getBoundingClientRect().top;
      container.scrollTo({ top: container.scrollTop + delta, behavior: "smooth" });
    } else {
      container.scrollTop = 0;
    }
  }, [messages.length, loading]);

  // Once a bubble finishes typing (and its chips render), scroll so the WHOLE
  // bubble is in view — the bubble's height isn't known until typing completes.
  const scrollToBottom = useCallback(() => {
    const container = scrollRef.current;
    if (container) container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
  }, []);

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
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-4 pt-4 pb-8 space-y-3">
        {messages.length === 0 && loading && (
          <p className="text-xs text-gray-400 text-center pt-2">Proxy is starting up…</p>
        )}
        {messages.map((msg, i) => {
          const isLast = i === messages.length - 1;
          return (
            <div key={i} ref={isLast ? lastMsgRef : null}>
              {msg.recommendations ? (
                // Cards first, then Proxy's message beneath them, then chat continues
                <div className="space-y-3">
                  <RecommendationCards recommendations={msg.recommendations} />
                  <div className="flex items-end gap-2">
                    <div className="w-7 h-7 rounded-full bg-red-100 text-red-600 text-xs font-bold flex items-center justify-center flex-shrink-0">
                      P
                    </div>
                    <div className="bg-gray-100 text-gray-800 rounded-2xl rounded-bl-sm px-3 py-2 text-sm leading-snug">
                      {msg.content}
                    </div>
                  </div>
                </div>
              ) : (
                <MessageBubble
                  message={msg}
                  // The latest question is answerable; past prompts get an Edit button
                  onAnswer={isLast && msg.question && !loading ? onAnswer : undefined}
                  onEdit={msg.question && !(isLast && !loading) && onEdit ? () => onEdit(msg.question.id) : undefined}
                  onReady={isLast ? scrollToBottom : undefined}
                />
              )}
            </div>
          );
        })}
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
            placeholder="Tap an option above, or type instead…"
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
