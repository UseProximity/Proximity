"use client";

/*
 * A landlord's Proxy chat for one listing, inside the Messages overlay
 * (Wyatt, 2026-10-27, round 6): the listing's questions and tour requests,
 * answered in one box. Same chat as the dashboard's Questions tab.
 */
import Link from "next/link";
import ChatAvatar from "@/components/chat/ChatAvatar";
import LandlordProxyChat from "@/components/landlord/LandlordProxyChat";
import { useMessages } from "@/context/MessagesContext";

export default function LandlordProxyThread({ thread, onBack }) {
  const { refreshThreads } = useMessages();
  const title = thread?.listingTitle?.trim() || thread?.listingAddress?.trim() || "Listing";
  const address = thread?.listingTitle && thread?.listingAddress && thread.listingAddress !== thread.listingTitle ? thread.listingAddress : "";
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-3 border-b border-gray-100 px-4 py-3">
        {onBack && (
          <button type="button" onClick={onBack} aria-label="Back to conversations" className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 md:hidden">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" /></svg>
          </button>
        )}
        <ChatAvatar src={thread?.listingImage} name={title} size="sm" shape={thread?.listingImage ? "square" : "circle"} />
        <div className="min-w-0 flex-1">
          <Link href="/dashboard/landlord?tab=questions" className="block truncate text-sm font-semibold text-gray-900 hover:text-red-600 hover:underline">{title}</Link>
          {address && <p className="truncate text-xs text-gray-400">{address}</p>}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {thread?.listingId && <LandlordProxyChat listingId={thread.listingId} maxHeight="max-h-[52vh]" onChanged={() => refreshThreads().catch(() => {})} />}
      </div>
    </div>
  );
}
