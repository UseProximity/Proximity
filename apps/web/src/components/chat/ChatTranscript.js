"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import toast from "react-hot-toast";
import ChatAvatar from "@/components/chat/ChatAvatar";
import ChatAttachmentBubble from "@/components/chat/ChatAttachmentBubble";
import { formatListingRentLabel } from "@/utils/listingFormatters";
import {
  CHAT_ATTACHMENT_ACCEPT,
  CHAT_ATTACHMENT_ALLOWED_TYPES,
  CHAT_ATTACHMENT_MAX_BYTES,
  CHAT_ATTACHMENT_MAX_FILES,
  formatFileSize,
} from "@/lib/chat/attachments";

const MAX_BODY = 5000;
const WARN_AT = 4500;
const COMPOSER_MAX_LINES = 10;

function resizeComposerTextarea(el) {
  if (!el) return;
  el.style.height = "auto";
  const lineHeight = parseFloat(window.getComputedStyle(el).lineHeight) || 20;
  const maxHeight = lineHeight * COMPOSER_MAX_LINES;
  el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
  el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden";
}

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

/*
 * A thread covers one landlord and one student, not one property, so a
 * conversation can move from "412 Delmar" to "6633 Kingsbury" partway down.
 * Without a marker the landlord's "it is still available" reads as an answer
 * about whichever listing the reader had in mind. Shown on the first message
 * and wherever the listing changes, never on every message.
 */
function shouldShowListingDivider(prev, msg) {
  if (!msg?.listingId) return false;
  if (!prev) return true;
  return prev.listingId !== msg.listingId;
}

/*
 * listingId to label, for drawing the dividers.
 *
 * A message loaded through rpc_get_chat_messages carries its own listing title
 * and address, but one that arrived over Realtime is the raw table row and has
 * only the id. Collecting every label the thread has seen means a live message
 * about an already-discussed listing is labelled immediately, and the thread's
 * current listing covers the first message about a new one.
 */
function buildListingLabels(list, thread) {
  const labels = new Map();
  for (const msg of list) {
    if (!msg?.listingId || labels.has(msg.listingId)) continue;
    const label = msg.listingTitle || msg.listingAddress;
    if (label) labels.set(msg.listingId, label);
  }
  const threadLabel = thread?.listingTitle || thread?.listingAddress;
  if (thread?.listingId && threadLabel && !labels.has(thread.listingId)) {
    labels.set(thread.listingId, threadLabel);
  }
  return labels;
}

function shouldShowSessionDivider(prev, msg) {
  if (!msg?.createdAt) return false;
  if (!prev?.createdAt) return true;
  const prevDate = new Date(prev.createdAt);
  const msgDate = new Date(msg.createdAt);
  const prevMs = prevDate.getTime();
  const msgMs = msgDate.getTime();
  if (Number.isNaN(prevMs) || Number.isNaN(msgMs)) return false;
  // A new calendar day always gets a header, even when the messages are minutes
  // apart across midnight.
  if (startOfLocalDay(prevDate) !== startOfLocalDay(msgDate)) return true;
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
 * A centered day·time header starts each new day and each gap over 3h. Otherwise
 * time is hover / swipe-left. attachment messages render inline images /
 * downloadable files.
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
  const [pendingFiles, setPendingFiles] = useState([]);
  const [sending, setSending] = useState(false);
  const [swipeReveal, setSwipeReveal] = useState(0);
  const bottomRef = useRef(null);
  const listRef = useRef(null);
  const inputRef = useRef(null);
  const fileInputRef = useRef(null);
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
  const listingLabel = thread?.listingTitle || thread?.listingAddress || "";
  const listingLabels = buildListingLabels(list, thread);
  const listingRentLabel = formatListingRentLabel(
    thread?.listingMinRent,
    thread?.listingMaxRent
  );
  const canSend = (!!input.trim() || pendingFiles.length > 0) && !sending;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [list.length, lastMessageId]);

  useEffect(() => {
    resizeComposerTextarea(inputRef.current);
  }, [input]);

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
    const files = pendingFiles;
    if ((!text && files.length === 0) || sending || !thread?.threadId) return;
    setSending(true);
    setInput("");
    setPendingFiles([]);
    try {
      await onSend(thread.threadId, text, files);
    } catch (err) {
      setInput(text);
      setPendingFiles(files);
      toast.error(err?.message || "Failed to send message. Please try again.");
    } finally {
      setSending(false);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }

  function handlePickFiles(e) {
    const picked = Array.from(e.target.files || []);
    e.target.value = "";
    if (picked.length === 0) return;

    setPendingFiles((prev) => {
      const next = [...prev];
      for (const file of picked) {
        if (next.length >= CHAT_ATTACHMENT_MAX_FILES) {
          toast.error(`Max ${CHAT_ATTACHMENT_MAX_FILES} files per message`);
          break;
        }
        if (!CHAT_ATTACHMENT_ALLOWED_TYPES.has(file.type)) {
          toast.error("Images (JPEG, PNG, WebP, GIF) and PDFs only");
          continue;
        }
        if (!Number.isFinite(file.size) || file.size <= 0 || file.size > CHAT_ATTACHMENT_MAX_BYTES) {
          toast.error("Each file must be 20MB or smaller");
          continue;
        }
        next.push(file);
      }
      return next;
    });
  }

  function removePendingFile(index) {
    setPendingFiles((prev) => prev.filter((_, i) => i !== index));
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
          src={thread?.listingImage || thread?.otherUserImage}
          name={thread?.listingTitle || thread?.otherUserName}
          size="sm"
          shape={thread?.listingImage ? "square" : "circle"}
        />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900 truncate">
            {thread?.otherUserName || "Conversation"}
          </p>
          {(listingLabel || listingRentLabel) && (
            <div className="flex items-baseline justify-between gap-2 min-w-0">
              {listingLabel ? (
                thread?.listingId ? (
                  <Link
                    href={`/listings/${thread.listingId}`}
                    className="text-xs text-gray-400 truncate hover:text-red-600 hover:underline min-w-0"
                    title={`View ${listingLabel}`}
                  >
                    {listingLabel}
                  </Link>
                ) : (
                  <p className="text-xs text-gray-400 truncate min-w-0">
                    {listingLabel}
                  </p>
                )
              ) : (
                <span className="min-w-0" />
              )}
              {listingRentLabel ? (
                <p className="text-xs font-medium text-gray-600 tabular-nums flex-shrink-0">
                  {listingRentLabel}
                </p>
              ) : null}
            </div>
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
            const isAttachment = msg.messageType === "attachment";
            const showListing = shouldShowListingDivider(prev, msg);
            const listingContext = showListing
              ? listingLabels.get(msg.listingId) ?? null
              : null;

            return (
              <div key={msg.id} className="space-y-2">
                {showSession && sessionLabel && (
                  <p className="text-[11px] text-gray-400 text-center py-2 select-none">
                    {sessionLabel}
                  </p>
                )}
                {listingContext && (
                  <div className="flex items-center gap-2 py-2 select-none">
                    <span className="h-px flex-1 bg-gray-200" />
                    {msg.listingId ? (
                      <Link
                        href={`/listings/${msg.listingId}`}
                        className="text-[11px] font-medium text-gray-500 hover:text-red-600 hover:underline max-w-[70%] truncate"
                        title={`View ${listingContext}`}
                      >
                        about {listingContext}
                      </Link>
                    ) : (
                      <span className="text-[11px] font-medium text-gray-500 max-w-[70%] truncate">
                        about {listingContext}
                      </span>
                    )}
                    <span className="h-px flex-1 bg-gray-200" />
                  </div>
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
                    {isAttachment ? (
                      <div
                        className={`relative max-w-[72%] ${
                          msg.isMine ? "items-end" : "items-start"
                        }`}
                      >
                        <ChatAttachmentBubble message={msg} />
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
                      </div>
                    ) : (
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
                      </div>
                    )}
                  </div>
                  {msg.id === readReceiptMessageId && readReceiptTime && (
                    <p className="mt-1 text-[11px] text-gray-400 text-right select-none">
                      Read · {readReceiptTime}
                    </p>
                  )}
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
        {pendingFiles.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {pendingFiles.map((file, i) => (
              <span
                key={`${file.name}-${i}`}
                className="inline-flex items-center gap-1 max-w-full rounded-lg bg-gray-100 border border-gray-200 pl-2 pr-1 py-1 text-[11px] text-gray-700"
              >
                <span className="truncate max-w-[10rem]">{file.name}</span>
                <span className="text-gray-400 flex-shrink-0">
                  {formatFileSize(file.size)}
                </span>
                <button
                  type="button"
                  onClick={() => removePendingFile(i)}
                  disabled={sending}
                  className="p-0.5 rounded text-gray-400 hover:text-gray-700 disabled:opacity-40"
                  aria-label={`Remove ${file.name}`}
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="flex items-start gap-2">
          <div
            className={`flex-1 min-w-0 flex items-end gap-2 bg-gray-50 rounded-xl border px-3 py-2 ${
              sending ? "border-gray-200 opacity-80" : "border-gray-200"
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept={CHAT_ATTACHMENT_ACCEPT}
              multiple
              className="hidden"
              onChange={handlePickFiles}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={sending || pendingFiles.length >= CHAT_ATTACHMENT_MAX_FILES}
              className="mb-0.5 flex-shrink-0 p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 disabled:opacity-40"
              aria-label="Attach files"
              title="Attach photos or PDFs"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.75}
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.007-.007l.005.005M8.56 18.313l.005.005"
                />
              </svg>
            </button>
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => {
                setInput(e.target.value.slice(0, MAX_BODY));
                resizeComposerTextarea(e.target);
              }}
              onKeyDown={handleKeyDown}
              rows={1}
              disabled={sending}
              placeholder={
                sending
                  ? "Sending…"
                  : pendingFiles.length
                    ? "Add a caption…"
                    : "Type a message..."
              }
              aria-busy={sending}
              className="flex-1 bg-transparent text-sm leading-5 text-gray-800 placeholder-gray-400 outline-none resize-none overflow-hidden py-1.5 disabled:cursor-not-allowed"
            />
            <button
              type="button"
              onClick={handleSend}
              disabled={!canSend}
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
