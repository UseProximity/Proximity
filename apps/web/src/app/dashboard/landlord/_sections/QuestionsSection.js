"use client";

/*
 * Questions from students, as a chat per listing (Wyatt, 2026-10-27, round 6).
 *
 * Left: the listings Proxy has brought questions or tour requests on, with
 * how many are waiting. Right: that listing's Proxy chat (LandlordProxyChat),
 * where the landlord answers in one box. The same chat is in their Messages
 * (Proxy tab) and under the listing's Agent tab. A student is never named on
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
      const qs = viewAsId ? `?viewAs=${encodeURIComponent(viewAsId)}` : "";
      const r = await fetch(`/api/landlord/proxy-chat${qs}`);
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
        <MessageCircleQuestion className="h-5 w-5 text-gray-400" /> No questions yet. Proxy answers students from what it knows and brings you only what it can&apos;t.
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-[260px_1fr]">
      <div className="space-y-1">
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
                <p className="truncate text-xs text-gray-500">{l.lastText}</p>
              </div>
              {waiting > 0 && <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-[11px] font-bold text-white">{waiting}</span>}
            </button>
          );
        })}
      </div>
      <div className="min-w-0 rounded-xl border border-gray-200 bg-white p-4">
        {active && <LandlordProxyChat key={active} listingId={active} viewAsId={viewAsId} onChanged={load} />}
      </div>
    </div>
  );
}
