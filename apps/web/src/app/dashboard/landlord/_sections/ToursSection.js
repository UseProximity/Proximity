"use client";

/*
 * Tour requests, for landlords (PRD v3, milestone 5).
 *
 * Each request shows the student's name, the lease and the times they can
 * make. Confirm one, or propose other times on a date grid; the student
 * picks and the tour is booked. On confirmation both sides get each
 * other's contact details and a conversation opens in Messages.
 */
import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { CalendarDays, CheckCircle2 } from "lucide-react";
import { DatePicker } from "@/components/proxy/AvailabilityGrid";
import { fmtSlot } from "@/lib/agents/tourTime";

function RequestCard({ t, onDone, viewAsId = null }) {
  const [proposing, setProposing] = useState(false);
  const [picked, setPicked] = useState(() => new Set());
  const [busy, setBusy] = useState(false);

  const act = async (body) => {
    if (busy) return;
    setBusy(true);
    try {
      const qs = viewAsId ? `?viewAs=${encodeURIComponent(viewAsId)}` : "";
      const r = await fetch(`/api/landlord/tours/${t.id}${qs}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(data?.error || "Could not update the tour."); return; }
      toast.success(body.action === "confirm" ? "Tour confirmed. You both have each other's contact details now." : body.action === "propose" ? "Sent to the student." : "Cancelled.");
      onDone();
    } finally {
      setBusy(false);
    }
  };

  const future = t.studentSlots.filter((s) => Date.parse(s) > Date.now());
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="font-semibold text-gray-900">{t.studentName}</p>
          <p className="text-xs text-gray-500">{t.listingTitle}{t.lease ? ` · ${t.lease.unit}${t.lease.rent ? ` at $${Number(t.lease.rent).toLocaleString("en-US")}/mo` : ""}` : ""}</p>
        </div>
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">{t.status === "proposed" ? "Waiting on the student" : "New request"}</span>
      </div>
      {t.status === "requested" && (
        <>
          <p className="mt-2 text-xs text-gray-600">They can make any of these. Tap one to confirm:</p>
          <div className="mt-1 flex flex-wrap gap-2">
            {future.map((s) => (
              <button key={s} type="button" disabled={busy} onClick={() => act({ action: "confirm", slot: s })} className="rounded-lg border border-red-300 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50">{fmtSlot(s)}</button>
            ))}
          </div>
        </>
      )}
      {t.status === "proposed" && (
        <p className="mt-2 text-xs text-gray-600">You proposed: {t.landlordSlots.map((s) => fmtSlot(s)).join("; ")}</p>
      )}
      {proposing ? (
        <div className="mt-3 rounded-lg border border-gray-100 p-2">
          <p className="mb-1 text-xs font-semibold text-gray-700">Pick as many times as you like (St. Louis time)</p>
          <DatePicker selected={picked} onToggle={(iso) => setPicked((p) => { const n = new Set(p); if (n.has(iso)) n.delete(iso); else n.add(iso); return n; })} />
          <div className="mt-2 flex gap-2">
            <button type="button" disabled={busy || !picked.size} onClick={() => act({ action: "propose", slots: [...picked] })} className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">Send these times</button>
            <button type="button" onClick={() => setProposing(false)} className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-700">Back</button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex gap-3 text-xs">
          <button type="button" onClick={() => setProposing(true)} className="text-red-600 underline">Propose other times</button>
          <button type="button" disabled={busy} onClick={() => act({ action: "cancel" })} className="text-gray-500 hover:text-gray-800">Decline</button>
        </div>
      )}
    </div>
  );
}

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
    } catch (err) {
      setError(err.message);
    }
  }, [viewAsId]);
  useEffect(() => { load(); }, [load]);

  if (error) return <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  if (!tours) return <div className="py-8 text-center text-sm text-gray-400">Loading tours...</div>;
  const open = tours.filter((t) => ["requested", "proposed"].includes(t.status));
  const confirmed = tours.filter((t) => t.status === "confirmed" && Date.parse(t.confirmedSlot) > Date.now() - 2 * 3600 * 1000);

  return (
    <div className="space-y-6">
      <p className="text-sm text-gray-600">Students book tours through Proxy with the times they can make. Confirm one or propose others. When a time is confirmed you get their phone or email, they get yours, and a conversation opens in Messages.</p>
      {open.length === 0 ? (
        <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 p-5 text-sm text-gray-500"><CalendarDays className="h-5 w-5 text-gray-400" /> No open tour requests.</div>
      ) : open.map((t) => <RequestCard key={t.id} t={t} onDone={load} viewAsId={viewAsId} />)}
      {confirmed.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-gray-900">Upcoming tours</h3>
          {confirmed.map((t) => (
            <div key={t.id} className="rounded-xl border border-gray-100 bg-white p-3 text-sm">
              <div className="flex items-center gap-2 text-xs text-gray-500"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> {t.listingTitle}{t.lease ? ` · ${t.lease.unit}` : ""}</div>
              <p className="mt-1 font-medium text-gray-900">{fmtSlot(t.confirmedSlot)} with {t.studentName}</p>
              {t.contact && <p className="text-gray-600">{[t.contact.phone, t.contact.email].filter(Boolean).join(" · ")}</p>}
              {t.threadId && <a href={`/messages?thread=${t.threadId}`} className="text-xs text-red-600 underline">Open the conversation</a>}
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
