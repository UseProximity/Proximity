"use client";

/*
 * Book a tour, under the Proxy conversation (PRD v3, milestone 5).
 *
 * Signed in only. The student paints the hours they can tour over the next
 * seven real dates, confirms a phone number, and sends. What they painted
 * is also saved on their account as a weekday pattern and painted in for
 * them next time (Wyatt, 2026-10-27). The card then tracks the request:
 * waiting, the landlord's proposed times to pick from, or confirmed with
 * the landlord's contact details and a link to the conversation.
 */
import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { CalendarDays, X } from "lucide-react";
import { DateGrid, zoneAbbrev } from "./AvailabilityGrid";
import { slotsFromPattern, fmtSlot, chicagoParts, DAYS } from "@/lib/agents/tourTime";

const GRID_DAYS = 7;

/* The weekday pattern implied by a set of real-date slots. */
function patternFromSlots(slots) {
  const pattern = {};
  for (const iso of slots) {
    const p = chicagoParts(new Date(iso));
    const day = DAYS.includes(p.weekday) ? p.weekday : null;
    if (!day) continue;
    pattern[day] = [...new Set([...(pattern[day] ?? []), p.h])].sort((a, b) => a - b);
  }
  return pattern;
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
  const [selected, setSelected] = useState(() => new Set());
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState(null);
  // The lease is the one the conversation is about (the panel's selection).
  const leaseId = initialLeaseId ?? (leaseChoices.length === 1 ? leaseChoices[0].id : null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [a, t] = await Promise.all([
        fetch("/api/tours/availability").then((r) => r.json()),
        fetch(`/api/tours?listingId=${encodeURIComponent(listingId)}`).then((r) => r.json()),
      ]);
      // Last time's hours, painted onto this week's dates.
      setSelected(new Set(slotsFromPattern(a.pattern ?? {}, { days: GRID_DAYS })));
      setPhone(a.phone ?? "");
      setEmail(a.email ?? null);
      setTour(t.tour ?? null);
    } catch {
      toast.error("Could not load your availability.");
    } finally {
      setLoading(false);
    }
  }, [listingId]);

  useEffect(() => { load(); }, [load]);

  const submit = async () => {
    if (busy) return;
    const slots = [...selected].sort();
    if (!slots.length) { toast.error("Pick at least one time."); return; }
    if (!phone.trim() && !String(email ?? "").trim()) { toast.error("Add a phone number or email so the landlord can reach you."); return; }
    setBusy(true);
    try {
      const r = await fetch("/api/tours", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ listingId, leaseId: leaseId || null, slots, phone: phone.trim() || null, email: String(email ?? "").trim() || null, pattern: patternFromSlots(slots), proxyThreadId }) });
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
      <div className="mb-3">
        <DateGrid selected={selected} onChange={setSelected} days={GRID_DAYS} />
        <p className="mt-1 text-[11px] text-gray-500">{selected.size} time{selected.size === 1 ? "" : "s"} selected ({zoneAbbrev()}).</p>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-[9rem] flex-1 flex-col gap-1 text-xs text-gray-600">
          Phone
          <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(314) 555-0100" className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm text-gray-900" />
        </label>
        <label className="flex min-w-[11rem] flex-1 flex-col gap-1 text-xs text-gray-600">
          Email
          <input type="email" value={email ?? ""} onChange={(e) => setEmail(e.target.value)} placeholder="you@wustl.edu" className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm text-gray-900" />
        </label>
        <button type="button" disabled={busy || !selected.size} onClick={submit} className="h-[34px] rounded-lg bg-red-600 px-4 text-sm font-semibold text-white disabled:opacity-50">
          {busy ? "Sending..." : "Request a tour"}
        </button>
      </div>
    </div>
  );
}
