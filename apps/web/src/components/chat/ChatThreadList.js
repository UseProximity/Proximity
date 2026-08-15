"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Pin } from "lucide-react";
import ChatAvatar from "@/components/chat/ChatAvatar";
import { ASSISTANT_THREAD_ID } from "@/components/chat/assistantConstants";
import {
  CHAT_GROUP_MODES,
  CHAT_GROUP_MODE_LABELS,
  CHAT_GROUP_MODE_STORAGE_KEY,
  groupChatThreads,
  normalizeChatGroupMode,
} from "@/utils/chatThreadGrouping";

function formatPreviewTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const diffMs = Date.now() - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function threadPreview(thread) {
  const offerPreview =
    thread.lastMessageType === "discount_offer"
      ? thread.lastMessageMine
        ? "You sent an offer"
        : "Sent you an offer"
      : null;
  const attachmentPreview =
    thread.lastMessageType === "attachment"
      ? thread.lastMessageMine
        ? `You: ${thread.lastMessageBody || "Sent a file"}`
        : thread.lastMessageBody || "Sent a file"
      : null;
  if (offerPreview) return offerPreview;
  if (attachmentPreview) return attachmentPreview;
  return thread.lastMessageMine
    ? `You: ${thread.lastMessageBody || ""}`
    : thread.lastMessageBody || "";
}

function ThreadRow({ thread, selected, onSelect, onPrefetch }) {
  const preview = threadPreview(thread);
  return (
    <button
      type="button"
      onClick={() => onSelect(thread.threadId)}
      onMouseEnter={() => onPrefetch?.(thread.threadId)}
      onFocus={() => onPrefetch?.(thread.threadId)}
      className={`w-full flex items-center gap-3 px-4 py-3 text-left border-b border-gray-50 transition-colors ${
        selected ? "bg-red-50/60" : "hover:bg-gray-50"
      }`}
    >
      <div className="relative flex-shrink-0">
        <ChatAvatar
          src={thread.listingImage || thread.otherUserImage}
          name={thread.listingTitle || thread.otherUserName}
          shape={thread.listingImage ? "square" : "circle"}
        />
        {thread.hasUnread && (
          <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-red-500 ring-2 ring-white" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <p
            className={`text-sm truncate ${
              thread.hasUnread
                ? "font-bold text-gray-900"
                : "font-semibold text-gray-900"
            }`}
          >
            {thread.otherUserName || "Conversation"}
          </p>
          <span className="text-[10px] text-gray-400 flex-shrink-0">
            {formatPreviewTime(thread.lastMessageAt)}
          </span>
        </div>
        {thread.listingTitle && (
          <p className="text-[11px] text-gray-400 truncate mt-0.5">
            {thread.listingTitle}
          </p>
        )}
        <p
          className={`text-xs truncate mt-0.5 ${
            thread.hasUnread || thread.unreadCount > 0
              ? "text-gray-700 font-medium"
              : "text-gray-400"
          }`}
        >
          {preview}
        </p>
      </div>
      {typeof thread.unreadCount === "number" && thread.unreadCount > 0 && (
        <span className="flex-shrink-0 min-w-[1.25rem] h-5 px-1.5 bg-red-500 text-white text-[11px] font-bold rounded-full flex items-center justify-center">
          {thread.unreadCount > 99 ? "99+" : thread.unreadCount}
        </span>
      )}
    </button>
  );
}

function GroupModeControl({ mode, onChange }) {
  return (
    <div
      className="flex-shrink-0 px-3 py-2 border-b border-gray-100"
      role="group"
      aria-label="Organize conversations"
    >
      <div className="flex rounded-lg bg-gray-100 p-0.5">
        {CHAT_GROUP_MODES.map((value) => {
          const active = mode === value;
          return (
            <button
              key={value}
              type="button"
              onClick={() => onChange(value)}
              aria-pressed={active}
              className={`flex-1 px-2 py-1.5 rounded-md text-[11px] font-medium transition-colors ${
                active
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {CHAT_GROUP_MODE_LABELS[value]}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ProximityAssistantRow({ selected, onSelect }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(ASSISTANT_THREAD_ID)}
      className={`w-full flex items-center gap-3 px-4 py-3 text-left border-b border-red-100/80 transition-colors ${
        selected ? "bg-red-50/60" : "bg-red-50/30 hover:bg-red-50/50"
      }`}
    >
      <div className="relative flex-shrink-0">
        <div className="w-10 h-10 rounded-full bg-white border border-red-100 flex items-center justify-center overflow-hidden">
          <img src="/logo.svg" alt="" className="w-6 h-6" />
        </div>
        <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-red-500 ring-2 ring-white" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <p className="text-sm font-bold text-gray-900 truncate">
              Proximity Assistant
            </p>
            <span className="inline-flex items-center gap-0.5 flex-shrink-0 rounded-md bg-white/80 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-600 border border-red-100">
              <Pin className="w-2.5 h-2.5" />
              Pin
            </span>
          </div>
          <span className="text-[10px] text-gray-400 flex-shrink-0">now</span>
        </div>
        <p className="text-xs truncate mt-0.5 text-gray-700 font-medium">
          Is 512 Forest Park Blvd still available?
        </p>
      </div>
      <span className="flex-shrink-0 min-w-[1.25rem] h-5 px-1.5 bg-red-500 text-white text-[11px] font-bold rounded-full flex items-center justify-center">
        1
      </span>
    </button>
  );
}

/**
 * Inbox rows from useMessages().threads
 */
export default function ChatThreadList({
  threads,
  activeThreadId,
  onSelect,
  onPrefetch,
  onBrowse,
  loading = false,
  error = false,
  onRetry,
}) {
  const [groupMode, setGroupMode] = useState("recent");

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(CHAT_GROUP_MODE_STORAGE_KEY);
      setGroupMode(normalizeChatGroupMode(stored));
    } catch {
      // ignore storage errors
    }
  }, []);

  const handleGroupModeChange = useCallback((next) => {
    const normalized = normalizeChatGroupMode(next);
    setGroupMode(normalized);
    try {
      window.localStorage.setItem(CHAT_GROUP_MODE_STORAGE_KEY, normalized);
    } catch {
      // ignore storage errors
    }
  }, []);

  const organized = useMemo(
    () => groupChatThreads(threads, groupMode),
    [threads, groupMode]
  );

  if (loading) {
    return (
      <div className="flex flex-col flex-1 min-h-0">
        <ProximityAssistantRow
          selected={activeThreadId === ASSISTANT_THREAD_ID}
          onSelect={onSelect}
        />
        <div className="flex flex-1 items-center justify-center py-12 min-h-0">
          <div
            className="w-6 h-6 border-2 border-gray-200 border-t-red-500 rounded-full animate-spin"
            role="status"
            aria-label="Loading conversations"
          />
        </div>
      </div>
    );
  }

  if (error && !threads?.length) {
    return (
      <div className="flex flex-col flex-1 min-h-0">
        <ProximityAssistantRow
          selected={activeThreadId === ASSISTANT_THREAD_ID}
          onSelect={onSelect}
        />
        <div className="flex flex-col flex-1 items-center justify-center gap-3 py-12 px-6 text-center min-h-0">
          <p className="text-sm text-gray-500 max-w-[240px]">
            Couldn&apos;t load conversations. Check your connection and try
            again.
          </p>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="mt-1 inline-flex items-center justify-center rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium px-4 py-2 transition-colors"
            >
              Try again
            </button>
          )}
        </div>
      </div>
    );
  }

  if (!threads?.length) {
    return (
      <div className="flex flex-col flex-1 min-h-0">
        <ProximityAssistantRow
          selected={activeThreadId === ASSISTANT_THREAD_ID}
          onSelect={onSelect}
        />
        <div className="flex flex-col flex-1 items-center justify-center gap-3 py-12 px-6 text-center min-h-0">
          <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center">
            <svg
              className="w-6 h-6 text-red-400"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z"
              />
            </svg>
          </div>
          <p className="text-sm text-gray-500 max-w-[240px]">
            No conversations yet. Message a landlord from a listing to get
            started.
          </p>
          <Link
            href="/browse"
            onClick={() => onBrowse?.()}
            className="mt-1 inline-flex items-center justify-center rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium px-4 py-2 transition-colors"
          >
            Browse listings
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <GroupModeControl mode={groupMode} onChange={handleGroupModeChange} />
      <ProximityAssistantRow
        selected={activeThreadId === ASSISTANT_THREAD_ID}
        onSelect={onSelect}
      />
      <div className="flex-1 overflow-y-auto min-h-0">
        {organized.flat
          ? organized.flat.map((thread) => (
              <ThreadRow
                key={thread.threadId}
                thread={thread}
                selected={thread.threadId === activeThreadId}
                onSelect={onSelect}
                onPrefetch={onPrefetch}
              />
            ))
          : organized.groups.map((group) => (
              <div key={group.key}>
                <div className="sticky top-0 z-10 px-4 py-1.5 bg-gray-50/95 backdrop-blur-sm border-b border-gray-100">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 truncate">
                    {group.label}
                  </p>
                </div>
                {group.threads.map((thread) => (
                  <ThreadRow
                    key={thread.threadId}
                    thread={thread}
                    selected={thread.threadId === activeThreadId}
                    onSelect={onSelect}
                    onPrefetch={onPrefetch}
                  />
                ))}
              </div>
            ))}
      </div>
    </div>
  );
}
