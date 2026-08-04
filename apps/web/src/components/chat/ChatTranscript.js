"use client";

import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import ChatAvatar from "@/components/chat/ChatAvatar";

const MAX_BODY = 5000;
const WARN_AT = 4500;
/** New centered day+time header when the gap from the previous message exceeds this. */
const SESSION_GAP_MS = 3 * 60 * 60 * 1000;
const SWIPE_TIME_PX = 56;

function startOfLocalDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function formatDayPart(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const today = startOfLocalDay(new Date());
  const day = startOfLocalDay(d);
  const diffDays = Math.round((today - day) / 86400000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(d.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}),
  });
}

function formatMessageTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatSessionDivider(iso) {
  const day = formatDayPart(iso);
  const time = formatMessageTime(iso);
  if (day && time) return `${day} · ${time}`;
  return day || time;
}

function shouldShowSessionDivider(prev, msg) {
  if (!msg?.createdAt) return false;
  if (!prev?.createdAt) return true;
  const prevMs = new Date(prev.createdAt).getTime();
  const msgMs = new Date(msg.createdAt).getTime();
  if (Number.isNaN(prevMs) || Number.isNaN(msgMs)) return false;
  return msgMs - prevMs >= SESSION_GAP_MS;
}

/** Id of the latest message of mine that the other user has read (or null). */
function findReadReceiptMessageId(list, otherUserLastReadAt) {
  if (!otherUserLastReadAt || !list?.length) return null;
  const readMs = new Date(otherUserLastReadAt).getTime();
  if (Number.isNaN(readMs)) return null;
  for (let i = list.length - 1; i >= 0; i--) {
    const msg = list[i];
    if (!msg?.isMine || String(msg.id).startsWith("temp-")) continue;
    const createdMs = new Date(msg.createdAt).getTime();
    if (Number.isNaN(createdMs)) continue;
    if (createdMs <= readMs) return msg.id;
  }
  return null;
}

/**
 * Message bubbles + composer for one thread (useMessages messages + sendMessage).
 * Session gaps (>3h) show a centered day·time. Otherwise time is hover / swipe-left.
 */
export default function ChatTranscript({
  thread,
  messages,
  messagesLoading = false,
  onSend,
  onBack,
  headerActions = null,
}) {
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [swipeReveal, setSwipeReveal] = useState(0);
  const bottomRef = useRef(null);
  const listRef = useRef(null);
  const touchRef = useRef({
    x: 0,
    y: 0,
    tracking: false,
    axis: null,
  });
  const list = messages ?? [];
  const lastMessageId = list.length ? list[list.length - 1].id : null;
  const nearLimit = input.length >= WARN_AT;
  const readReceiptMessageId = findReadReceiptMessageId(
    list,
    thread?.otherUserLastReadAt
  );
  const readReceiptTime = formatMessageTime(thread?.otherUserLastReadAt);
  const showLoading = messagesLoading && list.length === 0;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [list.length, lastMessageId]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;

    function onTouchStart(e) {
      const t = e.touches[0];
      touchRef.current = {
        x: t.clientX,
        y: t.clientY,
        tracking: true,
        axis: null,
      };
    }

    function onTouchMove(e) {
      const state = touchRef.current;
      if (!state.tracking) return;
      const t = e.touches[0];
      const dx = t.clientX - state.x;
      const dy = t.clientY - state.y;

      if (!state.axis) {
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
        state.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
        if (state.axis === "y") {
          state.tracking = false;
          setSwipeReveal(0);
          return;
        }
      }

      if (state.axis !== "x") return;
      e.preventDefault();
      const reveal = Math.min(1, Math.max(0, -dx / SWIPE_TIME_PX));
      setSwipeReveal(reveal);
    }

    function onTouchEnd() {
      touchRef.current.tracking = false;
      touchRef.current.axis = null;
      setSwipeReveal(0);
    }

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);
    el.addEventListener("touchcancel", onTouchEnd);
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
    };
  }, []);

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

  const shiftPx = swipeReveal * SWIPE_TIME_PX;

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

      <div
        ref={listRef}
        className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-3 space-y-2 min-h-0 touch-pan-y"
      >
        {showLoading ? (
          <div className="flex flex-1 items-center justify-center py-12 min-h-[8rem]">
            <div
              className="w-6 h-6 border-2 border-gray-200 border-t-red-500 rounded-full animate-spin"
              role="status"
              aria-label="Loading messages"
            />
          </div>
        ) : list.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">
            No messages yet. Say hello!
          </p>
        ) : (
          list.map((msg, i) => {
            const prev = i > 0 ? list[i - 1] : null;
            const showSession = shouldShowSessionDivider(prev, msg);
            const timeLabel = formatMessageTime(msg.createdAt);
            const sessionLabel = formatSessionDivider(msg.createdAt);

            return (
              <div key={msg.id} className="space-y-2">
                {showSession && sessionLabel && (
                  <p className="text-[11px] text-gray-400 text-center py-2 select-none">
                    {sessionLabel}
                  </p>
                )}
                <div className="group relative">
                  <div
                    className={`flex items-end gap-2 transition-transform duration-75 ease-out ${
                      msg.isMine ? "flex-row-reverse" : "flex-row"
                    }`}
                    style={{
                      transform:
                        shiftPx > 0 ? `translateX(${-shiftPx}px)` : undefined,
                    }}
                  >
                    {!msg.isMine && (
                      <ChatAvatar
                        src={thread?.otherUserImage}
                        name={thread?.otherUserName}
                        size="sm"
                      />
                    )}
                    <div
                      className={`relative max-w-[72%] ${
                        msg.isMine ? "items-end" : "items-start"
                      }`}
                    >
                      <div
                        className={`px-3 py-2 rounded-2xl text-sm leading-snug whitespace-pre-wrap break-words ${
                          msg.isMine
                            ? "bg-red-600 text-white rounded-br-sm"
                            : "bg-gray-100 text-gray-800 rounded-bl-sm"
                        } ${String(msg.id).startsWith("temp-") ? "opacity-70" : ""}`}
                      >
                        {msg.body}
                      </div>
                      {timeLabel && (
                        <time
                          dateTime={msg.createdAt}
                          className={`pointer-events-none absolute bottom-1 text-[10px] text-gray-400 tabular-nums whitespace-nowrap opacity-0 transition-opacity duration-100 [@media(hover:hover)]:group-hover:opacity-100 ${
                            msg.isMine
                              ? "right-full mr-1.5 text-right"
                              : "left-full ml-1.5 text-left"
                          }`}
                        >
                          {timeLabel}
                        </time>
                      )}
                      {msg.id === readReceiptMessageId && readReceiptTime && (
                        <p className="mt-1 text-[11px] text-gray-400 text-right select-none">
                          Read · {readReceiptTime}
                        </p>
                      )}
                    </div>
                  </div>
                  {timeLabel && swipeReveal > 0 && (
                    <time
                      dateTime={msg.createdAt}
                      className="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 w-14 text-right text-[10px] text-gray-400 tabular-nums"
                      style={{ opacity: Math.max(0.25, swipeReveal) }}
                      aria-hidden
                    >
                      {timeLabel}
                    </time>
                  )}
                </div>
              </div>
            );
          })
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
