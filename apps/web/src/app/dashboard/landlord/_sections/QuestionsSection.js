"use client";

/*
 * Questions from students, as a chat per listing (Wyatt, 2026-10-27, round 6).
 *
 * Left: one row per listing students have asked about (every unit's
 * questions together), recent activity first, with how many questions and
 * tour requests are waiting. Right: that listing's one chat
 * (LandlordProxyChat), where the landlord answers students and talks to the
 * listing's agent in one box. The same chat is in their Messages (Proxy tab)
 * and the listing's Agent tab. A student is never named on
 * a question; phone numbers, emails and links are removed from anything
 * passed on.
 */
import { useCallback, useEffect, useState } from "react";
import { MessageCircleQuestion } from "lucide-react";
import LandlordProxyChat from "@/components/landlord/LandlordProxyChat";
import ChatSkeleton from "@/components/chat/ChatSkeleton";

export default function QuestionsSection({ viewAsId = null, onCountChange = null }) {
  const [listings, setListings] = useState(null);
  const [active, setActive] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const qs = viewAsId ? `&viewAs=${encodeURIComponent(viewAsId)}` : "";
      const r = await fetch(`/api/landlord/proxy-chat?questions=1${qs}`);
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data?.error || "Could not load questions");
      setListings(data.listings ?? []);
      setActive((a) => a ?? data.listings?.[0]?.listingId ?? null);
      onCountChange?.(data.waiting?.total ?? 0);
      setError(null);
    } catch (err) { setError(err.message); }
  }, [viewAsId, onCountChange]);
  useEffect(() => { load(); }, [load]);

  if (error) return <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  if (!listings) return <ChatSkeleton rows={4} />;

  if (!listings.length) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 p-5 text-sm text-gray-500">
        <MessageCircleQuestion className="h-5 w-5 text-gray-400" /> No questions yet. When a student asks Proxy something it can&apos;t answer, the listing shows up here.
      </div>
    );
  }

  // One white panel filling the content area under the site header (Wyatt,
  // 2026-10-28): listings on the left, the chat on the right with its input
  // on the bottom edge. Only the list and the messages scroll; the page does
  // not. The heights match the dashboard's (105px header, 24px test banner,
  // 3rem of padding).
  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-gray-200 bg-white md:grid md:h-[calc(100dvh-105px-3rem)] md:grid-cols-[260px_1fr] md:[body:has(.staging-banner)_&]:h-[calc(100dvh-129px-3rem)]">
      <div className="max-h-64 space-y-1 overflow-y-auto border-b border-gray-200 p-2 md:max-h-none md:border-b-0 md:border-r">
        {listings.map((l) => {
          const waiting = l.openQuestions + l.openTours;
          return (
            <button
              key={l.listingId}
              type="button"
              onClick={() => setActive(l.listingId)}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left ${active === l.listingId ? "bg-red-50" : "hover:bg-gray-50"}`}
            >
              <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-gray-100">
                {l.image && <img src={l.image} alt="" className="h-full w-full object-cover" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className={`truncate text-sm ${waiting ? "font-bold text-gray-900" : "font-semibold text-gray-800"}`}>{l.title}</p>
                <p className="truncate text-xs text-gray-500">{l.lastText || "No messages yet"}</p>
              </div>
              {waiting > 0 && <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-[11px] font-bold text-white">{waiting}</span>}
            </button>
          );
        })}
      </div>
      <div className="flex h-[70dvh] min-h-0 min-w-0 flex-col p-4 md:h-auto">
        {active && <LandlordProxyChat key={active} listingId={active} viewAsId={viewAsId} fill onChanged={load} />}
      </div>
    </div>
  );
}
