"use client";

/*
 * Quiet note above the composer when the landlord has never replied
 * (lib/chat/followups.js decides when). No alert, no badge: just a nudge
 * toward similar listings. "Explore other places" opens browse in "similar to
 * this listing" mode (Wyatt, 2026-10-16).
 */
import { useEffect } from "react";
import Link from "next/link";
import { trackEvent } from "@/utils/analytics";

export default function NoReplyNote({ threadId, listingId, listingUnavailable = false }) {
  const variant = listingUnavailable ? "unavailable" : "no_reply";

  useEffect(() => {
    trackEvent("chat_no_reply_note_view", { thread_id: threadId, listing_id: listingId, variant });
  }, [threadId, listingId, variant]);

  const text = listingUnavailable
    ? "This place is no longer available."
    : "This landlord hasn't replied in 5 days. That usually means the place is no longer available.";

  return (
    <div className="mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 rounded-xl bg-gray-50 border border-gray-200 px-3 py-2 text-[13px] leading-5 text-gray-600">
      <p className="min-w-0">{text}</p>
      <Link
        href={`/browse?from=no-reply&similar=${encodeURIComponent(listingId)}`}
        onClick={() => trackEvent("chat_no_reply_explore_click", { thread_id: threadId, listing_id: listingId, variant })}
        className="flex-shrink-0 text-[13px] font-semibold text-gray-900 underline underline-offset-2 hover:text-gray-700"
      >
        Explore other places
      </Link>
    </div>
  );
}
