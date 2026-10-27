"use client";

/*
 * The student's tours, on their dashboard: upcoming confirmed tours with the
 * landlord's contact details, open requests, and what the landlord proposed.
 */
import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { CalendarDays } from "lucide-react";
import { fmtSlot } from "@/lib/agents/tourTime";

export default function StudentTours() {
  const [tours, setTours] = useState(null);
  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/tours");
      const data = await r.json().catch(() => ({}));
      if (r.ok) setTours(data.tours ?? []);
    } catch { /* leave empty */ }
  }, []);
  useEffect(() => { load(); }, [load]);

  const act = async (tour, action, slot = null) => {
    const r = await fetch(`/api/tours/${tour.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, slot }) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) { toast.error(data?.error || "Could not update the tour."); return; }
    toast.success(action === "pick" ? "Tour confirmed." : "Tour cancelled.");
    load();
  };

  const live = (tours ?? []).filter((t) => ["requested", "proposed", "confirmed"].includes(t.status));
  if (!tours || !live.length) return null;

  return (
    <div className="mb-10">
      <div className="flex items-center gap-2 mb-1">
        <CalendarDays className="w-5 h-5 text-gray-700" />
        <h2 className="text-lg font-bold text-gray-900">Tours</h2>
      </div>
      <div className="border-b border-gray-200 mb-4" />
      <div className="space-y-3">
        {live.map((t) => (
          <div key={t.id} className="rounded-xl border border-gray-200 bg-white p-4 text-sm">
            <div className="flex items-center justify-between gap-2">
              <a href={`/listings/${t.listingId}?listingTab=contact`} className="font-semibold text-gray-900 hover:underline">{t.listingTitle}</a>
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${t.status === "confirmed" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
                {t.status === "confirmed" ? "Confirmed" : t.status === "proposed" ? "Pick a time" : "Waiting on landlord"}
              </span>
            </div>
            {t.lease && <p className="text-xs text-gray-500">{t.lease.unit}{t.lease.rent ? ` at $${Number(t.lease.rent).toLocaleString("en-US")}/mo` : ""}</p>}
            {t.status === "confirmed" && (
              <div className="mt-1 text-gray-700">
                <p className="font-medium">{fmtSlot(t.confirmedSlot)}</p>
                {t.contact && <p>Landlord: {[t.contact.name, t.contact.phone, t.contact.email].filter(Boolean).join(" · ")}</p>}
                {t.threadId && <a href={`/messages?thread=${t.threadId}`} className="text-red-600 underline">Message the landlord</a>}
              </div>
            )}
            {t.status === "proposed" && (
              <div className="mt-2 flex flex-wrap gap-2">
                {t.landlordSlots.map((s) => (
                  <button key={s} type="button" onClick={() => act(t, "pick", s)} className="rounded-lg border border-red-300 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100">{fmtSlot(s)}</button>
                ))}
              </div>
            )}
            <button type="button" onClick={() => act(t, "cancel")} className="mt-2 text-xs text-gray-500 hover:text-gray-800">Cancel</button>
          </div>
        ))}
      </div>
    </div>
  );
}
