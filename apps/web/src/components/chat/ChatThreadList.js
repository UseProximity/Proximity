"use client";

import Link from "next/link";
import ChatAvatar from "@/components/chat/ChatAvatar";

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
  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center py-12 min-h-0">
        <div
          className="w-6 h-6 border-2 border-gray-200 border-t-red-500 rounded-full animate-spin"
          role="status"
          aria-label="Loading conversations"
        />
      </div>
    );
  }

  if (error && !threads?.length) {
    return (
      <div className="flex flex-col flex-1 items-center justify-center gap-3 py-12 px-6 text-center min-h-0">
        <p className="text-sm text-gray-500 max-w-[240px]">
          Couldn&apos;t load conversations. Check your connection and try again.
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
    );
  }

  if (!threads?.length) {
    return (
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
          No conversations yet. Message a landlord from a listing to get started.
        </p>
        <Link
          href="/browse"
          onClick={() => onBrowse?.()}
          className="mt-1 inline-flex items-center justify-center rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium px-4 py-2 transition-colors"
        >
          Browse listings
        </Link>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto min-h-0">
      {threads.map((thread) => {
        const selected = thread.threadId === activeThreadId;
        const preview = thread.lastMessageMine
          ? `You: ${thread.lastMessageBody || ""}`
          : thread.lastMessageBody || "";
        return (
          <button
            key={thread.threadId}
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
      })}
    </div>
  );
}
