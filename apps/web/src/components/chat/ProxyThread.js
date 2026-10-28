"use client";

/*
 * A Proxy conversation inside the Messages overlay (Wyatt, 2026-10-27): the
 * same panel as the listing's Contact tab, under a header that names the
 * listing and links to it. Tours are requested from the calendar button in
 * the input, as on the listing. No "Asking about" line here, and the input
 * stays pinned to the bottom while the conversation scrolls (round 7). The
 * listing is fetched here because the panel needs its units and leases.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import ChatAvatar from "@/components/chat/ChatAvatar";
import ChatSkeleton from "@/components/chat/ChatSkeleton";
import ProxyPanel from "@/components/proxy/ProxyPanel";

function leaseOf(listing, leaseId) {
  for (const u of listing?.unitTypes ?? []) {
    for (const l of u.leases ?? []) {
      if (l.id === leaseId) return { lease: l, unitLabel: u.name || ((u.bedrooms ?? 0) === 0 ? "Studio" : `${u.bedrooms ?? "?"} bed / ${u.bathrooms ?? "?"} bath`) };
    }
  }
  return { lease: null, unitLabel: null };
}

export default function ProxyThread({ thread, onBack }) {
  const { data: session } = useSession();
  const [listing, setListing] = useState(null);
  const [failed, setFailed] = useState(false);
  const listingId = thread?.listingId ?? null;

  useEffect(() => {
    if (!listingId) return;
    let cancelled = false;
    setListing(null);
    setFailed(false);
    fetch(`/api/listing/${listingId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled) { if (d) setListing(d); else setFailed(true); } })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [listingId]);

  const title = thread?.listingTitle?.trim() || thread?.listingAddress?.trim() || "Conversation";
  const address = thread?.listingTitle?.trim() && thread?.listingAddress?.trim() !== thread?.listingTitle?.trim() ? thread?.listingAddress : "";
  const { lease, unitLabel } = leaseOf(listing, thread?.leaseId);

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
          <Link href={`/listings/${listingId}?listingTab=contact`} className="block truncate text-sm font-semibold text-gray-900 hover:text-red-600 hover:underline" title={`View ${title}`}>{title}</Link>
          {address && <p className="truncate text-xs text-gray-400">{address}</p>}
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col p-4">
        {failed ? (
          <p className="text-sm text-gray-500">This listing is no longer available.</p>
        ) : !listing ? (
          <ChatSkeleton />
        ) : (
          <ProxyPanel listing={listing} session={session} selectedLease={lease} unitLabel={unitLabel} active fill showAbout={false} />
        )}
      </div>
    </div>
  );
}
