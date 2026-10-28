"use client";

/*
 * The tour picker that opens above the Proxy chat input (Wyatt, 2026-10-27,
 * round 6). The calendar button beside Send opens it: the same seven-day
 * grid as before, prefilled with the open request's times or the hours the
 * student usually picks. "Add to message" puts a short chip into the input
 * ("2 day availability"); sending the message sends the request, and the
 * conversation shows the full availability as plain ranges.
 *
 * With a tour already open the top line says where it stands (waiting,
 * talking with the landlord, or confirmed) and offers to cancel.
 */
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { DateGrid, zoneAbbrev } from "./AvailabilityGrid";
import { slotsFromPattern, availabilitySummary } from "@/lib/agents/tourTime";

const GRID_DAYS = 7;

function statusLine(tour) {
  if (!tour) return null;
  if (tour.status === "confirmed") return `Your tour is confirmed for ${tour.confirmedText}.`;
  if (tour.status === "messaging") return "The landlord is talking with you directly about a time.";
  return "Tour requested: waiting on the landlord to pick a time.";
}

export default function TourPicker({ tour, initial = null, onAdd, onCancelTour, onClose, busy = false }) {
  const [selected, setSelected] = useState(() => new Set(initial ?? []));
  const [loading, setLoading] = useState(!initial);

  // Nothing chosen yet in this message: the open request's times, else the
  // hours this student usually picks, painted onto this week's dates.
  useEffect(() => {
    if (initial) return;
    if (tour?.studentSlots?.length && tour.status !== "confirmed") {
      setSelected(new Set(tour.studentSlots));
      setLoading(false);
      return;
    }
    let cancelled = false;
    fetch("/api/tours/availability")
      .then((r) => (r.ok ? r.json() : {}))
      .then((a) => { if (!cancelled) setSelected(new Set(slotsFromPattern(a.pattern ?? {}, { days: GRID_DAYS }))); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [initial, tour]);

  const line = statusLine(tour);
  const confirmed = tour?.status === "confirmed";

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3 shadow-xl">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="text-sm">
          <p className="font-semibold text-gray-900">{tour && !confirmed ? "Change your tour times" : "When can you tour?"}</p>
          {line && <p className="text-xs text-gray-600">{line}</p>}
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-gray-700"><X className="h-4 w-4" /></button>
      </div>
      {loading ? (
        <div className="h-40 animate-pulse rounded-lg bg-gray-100" />
      ) : (
        <>
          <DateGrid selected={selected} onChange={setSelected} days={GRID_DAYS} />
          <p className="mt-1 text-[11px] text-gray-500">Drag across the hours you can make it ({zoneAbbrev()}).</p>
        </>
      )}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        {tour ? (
          <button type="button" disabled={busy} onClick={onCancelTour} className="text-xs text-gray-500 underline hover:text-gray-800 disabled:opacity-50">
            Cancel my tour request
          </button>
        ) : <span />}
        <button
          type="button"
          disabled={busy || loading || !selected.size}
          onClick={() => onAdd([...selected].sort())}
          className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
        >
          {selected.size ? `Add ${availabilitySummary([...selected])}` : "Pick some times"}
        </button>
      </div>
    </div>
  );
}
