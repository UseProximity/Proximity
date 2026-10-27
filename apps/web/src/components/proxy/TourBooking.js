"use client";

/*
 * Book a tour, under the Proxy conversation (PRD v3, milestone 5).
 *
 * Signed in only. The student's weekly availability (saved on the account)
 * becomes real dates over the next 14 days; they untick the ones that don't
 * work, pick the lease, confirm a phone or email, and send. The card then
 * tracks the request: waiting, the landlord's proposed times to pick from,
 * or confirmed with the landlord's contact details and a link to the
 * conversation that opened.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { CalendarDays, X } from "lucide-react";
import { WeeklyGrid } from "./AvailabilityGrid";
import { slotsFromPattern, fmtSlot, fmtDay, dayKey } from "@/lib/agents/tourTime";

function groupByDay(slots) {
  const groups = new Map();
  for (const s of slots) {
    const k = dayKey(s);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(s);
  }
  return [...groups.entries()];
}

function StatusCard({ tour, onCancel, onPick, busy }) {
  const open = ["requested", "proposed"].includes(tour.status);
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm">
      <div className="mb-1 flex items-center gap-2 text-xs font-semibold text-gray-700">
        <CalendarDays className="h-4 w-4 text-red-600" />
        {tour.status === "confirmed" ? "Tour confirmed" : tour.status === "proposed" ? "The landlord proposed other times" : tour.status === "requested" ? "Tour requested" : `Tour ${tour.status}`}
      </div>
      {tour.lease && <p className="text-xs text-gray-500">{tour.lease.unit}{tour.lease.rent ? ` at $${Number(tour.lease.rent).toLocaleString("en-US")}/mo` : ""}</p>}
      {tour.status === "requested" && (
        <p className="mt-1 text-gray-700">Waiting on the landlord. You offered {tour.studentSlots.length} time{tour.studentSlots.length === 1 ? "" : "s"}; they can confirm one or propose others.</p>
      )}
      {tour.status === "proposed" && (
        <div className="mt-2 flex flex-wrap gap-2">
          {tour.landlordSlots.map((s) => (
            <button key={s} type="button" disabled={busy} onClick={() => onPick(s)} className="rounded-lg border border-red-300 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50">{fmtSlot(s)}</button>
          ))}
        </div>
      )}
      {tour.status === "confirmed" && (
        <div className="mt-1 space-y-1 text-gray-700">
          <p className="font-medium">{fmtSlot(tour.confirmedSlot)}</p>
          {tour.contact && <p>Landlord: {[tour.contact.name, tour.contact.phone, tour.contact.email].filter(Boolean).join(" · ")}</p>}
          {tour.threadId && <a href={`/messages?thread=${tour.threadId}`} className="text-red-600 underline">Message the landlord</a>}
        </div>
      )}
      {(open || tour.status === "confirmed") && (
        <button type="button" disabled={busy} onClick={onCancel} className="mt-3 inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800">
          <X className="h-3 w-3" /> Cancel this tour
        </button>
      )}
    </div>
  );
}

export default function TourBooking({ listing, leaseChoices, initialLeaseId = null, proxyThreadId = null, onClose }) {
  const listingId = listing?._id;
  const [loading, setLoading] = useState(true);
  const [tour, setTour] = useState(null);
  const [pattern, setPattern] = useState({});
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState(null);
  const [leaseId, setLeaseId] = useState(initialLeaseId ?? (leaseChoices.length === 1 ? leaseChoices[0].id : ""));
  const [removed, setRemoved] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [editGrid, setEditGrid] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [a, t] = await Promise.all([
        fetch("/api/tours/availability").then((r) => r.json()),
        fetch(`/api/tours?listingId=${encodeURIComponent(listingId)}`).then((r) => r.json()),
      ]);
      setPattern(a.pattern ?? {});
      setPhone(a.phone ?? "");
      setEmail(a.email ?? null);
      setEditGrid(!Object.keys(a.pattern ?? {}).length);
      setTour(t.tour ?? null);
    } catch {
      toast.error("Could not load your availability.");
    } finally {
      setLoading(false);
    }
  }, [listingId]);

  useEffect(() => { load(); }, [load]);

  const slots = useMemo(() => slotsFromPattern(pattern).filter((s) => !removed.has(s)), [pattern, removed]);
  const grouped = useMemo(() => groupByDay(slots), [slots]);

  const submit = async () => {
    if (busy) return;
    if (leaseChoices.length > 1 && !leaseId) { toast.error("Pick which lease you want to tour."); return; }
    if (!slots.length) { toast.error("Pick at least one time."); return; }
    if (!phone.trim() && !email) { toast.error("Add a phone number so the landlord can reach you."); return; }
    setBusy(true);
    try {
      const r = await fetch("/api/tours", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ listingId, leaseId: leaseId || null, slots, phone: phone.trim() || null, pattern, proxyThreadId }) });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(data?.error || "Could not request the tour."); return; }
      setTour(data.tour);
      toast.success("Tour requested. We'll let you know when the landlord confirms.");
    } finally {
      setBusy(false);
    }
  };

  const act = async (action, slot = null) => {
    if (!tour || busy) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/tours/${tour.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, slot }) });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(data?.error || "Could not update the tour."); return; }
      setTour(data.tour);
      if (action === "pick") toast.success("Tour confirmed.");
      if (action === "cancel") { toast("Tour cancelled."); setTour(null); }
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="py-4 text-center text-sm text-gray-400">Loading your availability...</div>;

  if (tour && ["requested", "proposed", "confirmed"].includes(tour.status)) {
    return <StatusCard tour={tour} busy={busy} onCancel={() => act("cancel")} onPick={(s) => act("pick", s)} />;
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2 font-semibold text-gray-900"><CalendarDays className="h-4 w-4 text-red-600" /> Book a tour</div>
        {onClose && <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-700"><X className="h-4 w-4" /></button>}
      </div>
      <p className="mb-3 text-xs text-gray-500">Set the hours you can usually tour, untick any dates that don&apos;t work, and send. The landlord picks a time or proposes others. Your contact details are shared once a time is confirmed.</p>

      {leaseChoices.length > 1 && (
        <label className="mb-3 flex flex-col gap-1 text-xs text-gray-600">
          Which lease?
          <select value={leaseId} onChange={(e) => setLeaseId(e.target.value)} className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm text-gray-900">
            <option value="">Choose a lease</option>
            {leaseChoices.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </label>
      )}

      <div className="mb-3">
        <div className="mb-1 flex items-center justify-between text-xs">
          <span className="font-semibold text-gray-700">Your weekly availability</span>
          {!editGrid && <button type="button" onClick={() => setEditGrid(true)} className="text-red-600 underline">Edit</button>}
        </div>
        {editGrid ? <WeeklyGrid pattern={pattern} onChange={(p) => { setPattern(p); setRemoved(new Set()); }} /> : <p className="text-xs text-gray-500">Saved on your account. {slots.length} time{slots.length === 1 ? "" : "s"} over the next two weeks.</p>}
      </div>

      {slots.length > 0 && (
        <div className="mb-3 max-h-56 overflow-y-auto rounded-lg border border-gray-100 p-2">
          <p className="mb-1 text-xs font-semibold text-gray-700">Times you&apos;ll offer (untick any that don&apos;t work)</p>
          {grouped.map(([day, list]) => (
            <div key={day} className="mb-1">
              <div className="text-[11px] text-gray-500">{fmtDay(list[0])}</div>
              <div className="flex flex-wrap gap-1">
                {list.map((s) => (
                  <label key={s} className="inline-flex items-center gap-1 rounded bg-gray-50 px-1.5 py-0.5 text-[11px] text-gray-700">
                    <input type="checkbox" checked readOnly onClick={() => setRemoved((r) => new Set([...r, s]))} className="h-3 w-3" />
                    {fmtSlot(s, { withDate: false })}
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <label className="mb-3 flex flex-col gap-1 text-xs text-gray-600">
        Phone number for the landlord{email ? " (your email is shared too)" : ""}
        <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(314) 555-0100" className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm text-gray-900" />
      </label>

      <button type="button" disabled={busy || !slots.length} onClick={submit} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
        {busy ? "Sending..." : "Request a tour"}
      </button>
    </div>
  );
}
