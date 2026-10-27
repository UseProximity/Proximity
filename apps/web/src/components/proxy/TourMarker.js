"use client";

/*
 * The tour on a Proxy conversation (Wyatt, 2026-10-27): one chat per
 * listing, and the tour rides on it as a marker on the right. With no tour
 * it is the "Request a tour" button; once one is requested it turns green
 * with the status ("Tour requested", "Pick a time", the confirmed time) and
 * clicking it drops down the card with the details and the actions (edit
 * availability, pick a time, cancel, request again).
 *
 * useTour holds the tour; TourButton and TourCard render the two halves so
 * the Contact tab can put the button on its top line and the card below
 * (hooks stay unconditional in the panel), and the default TourMarker is
 * the popover version for the Messages header.
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

export function useTour(listingId, signedIn) {
  const [tour, setTour] = useState(null);
  useEffect(() => {
    if (!listingId || !signedIn) return;
    let cancelled = false;
    fetch(`/api/tours?listingId=${encodeURIComponent(listingId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled) setTour(d?.tour && LIVE.has(d.tour.status) ? d.tour : null); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [listingId, signedIn]);
  return { tour, setTour: (t) => setTour(t && LIVE.has(t.status) ? t : null) };
}

export function TourButton({ tour, signedIn, open, onOpenChange }) {
  const label = tourLabel(tour);
  if (!signedIn) {
    return (
      <button type="button" onClick={() => signIn()} className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white">
        <CalendarDays className="h-3.5 w-3.5" /> Sign in to request a tour
      </button>
    );
  }
  if (label) {
    return (
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800"
      >
        {tour.status === "confirmed" ? <Check className="h-3.5 w-3.5" /> : <CalendarDays className="h-3.5 w-3.5" />}
        {label}
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
    );
  }
  return (
    <button type="button" onClick={() => onOpenChange(!open)} aria-expanded={open} className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white">
      <CalendarDays className="h-3.5 w-3.5" /> Request a tour
    </button>
  );
}

export function TourCard({ listing, leaseChoices, leaseId = null, proxyThreadId = null, onClose, setTour }) {
  return (
    <TourBooking
      listing={listing}
      leaseChoices={leaseChoices}
      initialLeaseId={leaseId}
      proxyThreadId={proxyThreadId}
      onClose={onClose}
      onTourChange={setTour}
    />
  );
}

/* The popover version: the button with the card floating under it. */
export default function TourMarker({ listing, leaseChoices, leaseId = null, proxyThreadId = null, signedIn, open, onOpenChange }) {
  const { tour, setTour } = useTour(listing?._id, signedIn);
  const boxRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) onOpenChange(false); };
    const onKey = (e) => { if (e.key === "Escape") onOpenChange(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open, onOpenChange]);

  if (!leaseChoices?.length) return null;
  return (
    <div ref={boxRef} className="relative">
      <TourButton tour={tour} signedIn={signedIn} open={open} onOpenChange={onOpenChange} />
      {open && signedIn && (
        <div className="absolute right-0 top-full z-20 mt-2 w-[min(92vw,30rem)] rounded-xl bg-white shadow-xl">
          <TourCard listing={listing} leaseChoices={leaseChoices} leaseId={leaseId} proxyThreadId={proxyThreadId} onClose={() => onOpenChange(false)} setTour={setTour} />
        </div>
      )}
    </div>
  );
}
