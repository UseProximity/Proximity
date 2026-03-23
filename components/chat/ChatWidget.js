"use client";
import { useState, useRef, useEffect } from "react";
import { useChatContext } from "./ChatContext";

function TypingDots() {
  return (
    <div className="flex items-center gap-1 px-3 py-2">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="w-2 h-2 rounded-full bg-gray-400 animate-bounce"
          style={{ animationDelay: `${i * 0.15}s` }}
        />
      ))}
    </div>
  );
}

function Avatar({ src, name, size = "md" }) {
  const sz = size === "sm" ? "w-8 h-8 text-xs" : "w-10 h-10 text-sm";
  if (src && src !== "/images/default-profile.jpg") {
    return (
      <img
        src={src}
        alt={name}
        className={`${sz} rounded-full object-cover flex-shrink-0`}
      />
    );
  }
  const initials = name ? name.charAt(0).toUpperCase() : "?";
  return (
    <div
      className={`${sz} rounded-full bg-red-100 text-red-600 font-semibold flex items-center justify-center flex-shrink-0`}
    >
      {initials}
    </div>
  );
}

function ConversationList({ conversations, onSelect, onClose }) {
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <h2 className="text-base font-bold text-gray-900">Messages</h2>
        <button
          onClick={onClose}
          className="p-1.5 rounded-full hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        {conversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 py-12 px-6 text-center">
            <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center">
              <svg className="w-6 h-6 text-red-400" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
              </svg>
            </div>
            <p className="text-sm text-gray-400">No conversations yet. Contact a landlord or roommate to get started.</p>
          </div>
        ) : (
          conversations.map((conv) => {
            const last = conv.messages[conv.messages.length - 1];
            return (
              <button
                key={conv.id}
                onClick={() => onSelect(conv.id)}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors text-left border-b border-gray-50"
              >
                <Avatar src={conv.profile.image} name={conv.profile.name} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-gray-900 truncate">{conv.profile.name}</p>
                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full flex-shrink-0 ${
                      conv.type === "landlord"
                        ? "bg-blue-50 text-blue-600"
                        : "bg-green-50 text-green-600"
                    }`}>
                      {conv.type === "landlord" ? "Landlord" : "Roommate"}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400 truncate mt-0.5">
                    {conv.typing ? "Typing..." : (last?.text || "")}
                  </p>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

function ConversationThread({ conv, onBack, onClose, onSend }) {
  const [input, setInput] = useState("");
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conv.messages, conv.typing]);

  const handleSend = () => {
    const text = input.trim();
    if (!text) return;
    setInput("");
    onSend(conv.id, text);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-3 border-b border-gray-100">
        <button
          onClick={onBack}
          className="p-1.5 rounded-full hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors flex-shrink-0"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
        </button>
        <Avatar src={conv.profile.image} name={conv.profile.name} size="sm" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900 truncate">{conv.profile.name}</p>
          <p className="text-xs text-gray-400 capitalize">{conv.type}</p>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-full hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors flex-shrink-0"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {conv.messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex items-end gap-2 ${msg.direction === "outgoing" ? "flex-row-reverse" : "flex-row"}`}
          >
            {msg.direction === "incoming" && (
              <Avatar src={conv.profile.image} name={conv.profile.name} size="sm" />
            )}
            <div
              className={`max-w-[72%] px-3 py-2 rounded-2xl text-sm leading-snug ${
                msg.direction === "outgoing"
                  ? "bg-red-600 text-white rounded-br-sm"
                  : "bg-gray-100 text-gray-800 rounded-bl-sm"
              }`}
            >
              {msg.text}
            </div>
          </div>
        ))}
        {conv.typing && (
          <div className="flex items-end gap-2">
            <Avatar src={conv.profile.image} name={conv.profile.name} size="sm" />
            <div className="bg-gray-100 rounded-2xl rounded-bl-sm">
              <TypingDots />
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="px-3 pb-3 pt-2 border-t border-gray-100">
        <div className="flex items-center gap-2 bg-gray-50 rounded-xl border border-gray-200 px-3 py-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message..."
            className="flex-1 bg-transparent text-sm text-gray-800 placeholder-gray-400 outline-none"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim()}
            className="w-8 h-8 rounded-full bg-red-600 hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed text-white flex items-center justify-center transition-colors flex-shrink-0"
          >
            <svg className="w-4 h-4 translate-x-px" fill="currentColor" viewBox="0 0 24 24">
              <path d="M3.478 2.405a.75.75 0 00-.926.94l2.432 7.905H13.5a.75.75 0 010 1.5H4.984l-2.432 7.905a.75.75 0 00.926.94 60.519 60.519 0 0018.445-8.986.75.75 0 000-1.218A60.517 60.517 0 003.478 2.405z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ChatWidget() {
  const { conversations, widgetOpen, setWidgetOpen, activeId, setActiveId, sendMessage } =
    useChatContext();

  const totalConvs = conversations.length;
  const activeConv = conversations.find((c) => c.id === activeId) || null;

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3">
      {/* Panel */}
      {widgetOpen && (
        <div className="w-[360px] h-[480px] bg-white rounded-2xl shadow-2xl border border-gray-200 flex flex-col overflow-hidden">
          {activeConv ? (
            <ConversationThread
              conv={activeConv}
              onBack={() => setActiveId(null)}
              onClose={() => setWidgetOpen(false)}
              onSend={sendMessage}
            />
          ) : (
            <ConversationList
              conversations={conversations}
              onSelect={(id) => setActiveId(id)}
              onClose={() => setWidgetOpen(false)}
            />
          )}
        </div>
      )}

      {/* Floating button */}
      <button
        onClick={() => {
          if (widgetOpen) {
            setWidgetOpen(false);
          } else {
            setWidgetOpen(true);
            if (!activeId && conversations.length === 1) {
              setActiveId(conversations[0].id);
            }
          }
        }}
        className="w-14 h-14 rounded-full bg-red-600 hover:bg-red-700 text-white shadow-lg hover:shadow-xl transition-all flex items-center justify-center relative"
        aria-label="Open messages"
      >
        {widgetOpen ? (
          <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
          </svg>
        ) : (
          <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
          </svg>
        )}
        {/* Unread badge */}
        {!widgetOpen && totalConvs > 0 && (
          <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-white border-2 border-red-600 text-red-600 text-[10px] font-bold flex items-center justify-center">
            {totalConvs}
          </span>
        )}
      </button>
    </div>
  );
}
