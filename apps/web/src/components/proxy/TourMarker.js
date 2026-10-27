"use client";

/*
 * The tour on a Proxy conversation (Wyatt, 2026-10-27): one chat per
 * listing, and the tour rides on it as a marker on the right. With no tour
 * it is the "Book a tour" button; once one is requested it shows the status
 * ("Tour requested", "Pick a time", the confirmed time) and clicking it
 * drops down the booking card with the details and the actions (pick a
 * time, cancel, request again).
 *
 *   mode "inline"   the card opens underneath (the listing's Contact tab)
 *   mode "popover"  the card floats under the marker (the Messages header)
 */
import { useEffect, useRef, useState } from "react";
import { signIn } from "next-auth/react";
import { CalendarDays, ChevronDown, Check } from "lucide-react";
import TourBooking from "./TourBooking";
import { fmtSlot } from "@/lib/agents/tourTime";

const LIVE = new Set(["requested", "proposed", "confirmed"]);

export function tourLabel(tour) {
  if (!tour || !LIVE.has(tour.status)) return null;
  if (tour.status === "confirmed") return `Tour ${fmtSlot(tour.confirmedSlot)}`;
  if (tour.status === "proposed") return "Tour: pick a time";
  return "Tour requested";
}

export default function TourMarker({ listing, leaseChoices, leaseId = null, proxyThreadId = null, signedIn, open, onOpenChange, mode = "inline", disabled = false }) {
  const listingId = listing?._id;
  const [tour, setTour] = useState(null);
  const boxRef = useRef(null);

  useEffect(() => {
    if (!listingId || !signedIn) return;
    let cancelled = false;
    fetch(`/api/tours?listingId=${encodeURIComponent(listingId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled) setTour(d?.tour && LIVE.has(d.tour.status) ? d.tour : null); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [listingId, signedIn]);

  // A popover closes on a click outside or Escape.
  useEffect(() => {
    if (mode !== "popover" || !open) return;
    const onDown = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) onOpenChange(false); };
    const onKey = (e) => { if (e.key === "Escape") onOpenChange(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [mode, open, onOpenChange]);

  if (disabled || !leaseChoices?.length) return null;
  const label = tourLabel(tour);

  const button = !signedIn ? (
    <button type="button" onClick={() => signIn()} className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white">
      <CalendarDays className="h-3.5 w-3.5" /> Sign in to book a tour
    </button>
  ) : label ? (
    <button
      type="button"
      onClick={() => onOpenChange(!open)}
      aria-expanded={open}
      className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold ${tour.status === "confirmed" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}
    >
      {tour.status === "confirmed" ? <Check className="h-3.5 w-3.5" /> : <CalendarDays className="h-3.5 w-3.5" />}
      {label}
      <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
    </button>
  ) : (
    <button type="button" onClick={() => onOpenChange(!open)} aria-expanded={open} className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white">
      <CalendarDays className="h-3.5 w-3.5" /> Book a tour
    </button>
  );

  const card = open && signedIn ? (
    <TourBooking
      listing={listing}
      leaseChoices={leaseChoices}
      initialLeaseId={leaseId}
      proxyThreadId={proxyThreadId}
      onClose={() => onOpenChange(false)}
      onTourChange={(t) => setTour(t && LIVE.has(t.status) ? t : null)}
    />
  ) : null;

  if (mode === "popover") {
    return (
      <div ref={boxRef} className="relative">
        {button}
        {card && (
          <div className="absolute right-0 top-full z-20 mt-2 w-[min(92vw,30rem)] rounded-xl bg-white shadow-xl">
            {card}
          </div>
        )}
      </div>
    );
  }
  return { button, card };
}
