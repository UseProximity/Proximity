"use client";

/*
 * Tour requests, for landlords (PRD v3; reworked 2026-10-27, round 6).
 *
 * Each request shows the student's name, the lease and their availability
 * as plain ranges. Pick one of their days and type a start time inside a
 * window, or write to them directly when none of it works; either opens a
 * direct chat in Messages. Contact details are never handed over; the two
 * sides can share them in that chat. The same request also appears in the
 * listing's Proxy chat.
 */
import { useCallback, useEffect, useState } from "react";
import { CalendarDays } from "lucide-react";
import { TourItem } from "@/components/landlord/LandlordProxyChat";
import ChatSkeleton from "@/components/chat/ChatSkeleton";

const OPEN = ["requested", "proposed", "messaging"];

export default function ToursSection({ viewAsId = null }) {
  const [tours, setTours] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const qs = viewAsId ? `?viewAs=${encodeURIComponent(viewAsId)}` : "";
      const r = await fetch(`/api/landlord/tours${qs}`);
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data?.error || "Could not load tours");
      setTours(data.tours ?? []);
      setError(null);
    } catch (err) { setError(err.message); }
  }, [viewAsId]);
  useEffect(() => { load(); }, [load]);

  if (error) return <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  if (!tours) return <ChatSkeleton rows={3} />;

  const open = tours.filter((t) => OPEN.includes(t.status));
  const upcoming = tours.filter((t) => t.status === "confirmed" && Date.parse(t.confirmedSlot) > Date.now());
  const past = tours.filter((t) => !OPEN.includes(t.status) && !upcoming.includes(t)).slice(0, 20);

  const block = (title, list) => list.length > 0 && (
    <section className="space-y-4">
      <h3 className="text-sm font-semibold text-gray-900">{title} <span className="font-normal text-gray-500">({list.length})</span></h3>
      {list.map((t) => (
        <div key={t.id} className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="mb-2 text-xs font-semibold text-gray-500">{t.listingTitle}</p>
          <TourItem tour={t} viewAsId={viewAsId} onDone={load} />
        </div>
      ))}
    </section>
  );

  return (
    <div className="space-y-6">
      {tours.length === 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 p-5 text-sm text-gray-500">
          <CalendarDays className="h-5 w-5 text-gray-400" /> No tour requests yet. Students request tours from the chat on your listings.
        </div>
      )}
      {block("Waiting on you", open)}
      {block("Upcoming", upcoming)}
      {block("Past", past)}
    </div>
  );
}
