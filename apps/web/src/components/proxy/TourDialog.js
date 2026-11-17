"use client";

/*
 * The tour request popup (Wyatt, 2026-11-14), opened by Tour beside the
 * Proxy input. It replaces the small picker that sat above the input and
 * turned the student's times into a chip to send.
 *
 * The times are picked the same way as before: the seven-day hour grid,
 * prefilled with the open request's times or the hours the student usually
 * picks, with hours already taken by another booked tour in grey. Around it,
 * taking after a reference design Wyatt shared: a big "When can you tour
 * ...?" headline, the listing card, an optional note for Proxy, and who is
 * booking. It never scrolls (Wyatt, 2026-11-15): everything fits on one
 * screen, with shorter hour cells on short screens. Sending sends the request at
 * once; it shows in the chat like before. The note goes into the chat as
 * the student's own message, so Proxy reads and answers it there.
 *
 * No status line and no cancel link in here (Wyatt, 2026-11-15): once a
 * tour is requested, Tour beside the input shows a check and offers
 * "Edit tour" (this popup) or "Cancel tour" itself.
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Pencil, X } from "lucide-react";
import { DateGrid, zoneAbbrev } from "./AvailabilityGrid";
import { slotsFromPattern, fmtTourTime } from "@/lib/agents/tourTime";

const GRID_DAYS = 7;

// Each booked tour takes the one-hour cells it touches: 5:30pm greys 5pm and 6pm.
function bookedHours(list) {
  const out = new Map();
  for (const b of list) {
    const at = Date.parse(b.at);
    if (!Number.isFinite(at)) continue;
    const label = `${b.listing}, ${fmtTourTime(b.at)}`;
    const hour = 3600 * 1000;
    for (let t = Math.floor(at / hour) * hour; t < at + hour; t += hour) out.set(new Date(t).toISOString(), label);
  }
  return out;
}

function initials(name, email) {
  const words = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (words.length) return words.slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  return String(email || "?").slice(0, 1).toUpperCase();
}

function Label({ children, right = null }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-500">{children}</span>
      {right}
    </div>
  );
}

export default function TourDialog({ listing, session, tour, onSubmit, onClose, busy = false }) {
  const [selected, setSelected] = useState(() => new Set());
  const [loading, setLoading] = useState(true);
  const [booked, setBooked] = useState(() => new Map());
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const open = tour && ["requested", "proposed", "messaging"].includes(tour.status);
  const confirmed = tour?.status === "confirmed";

  // The open request's times, else the hours this student usually picks,
  // painted onto this week's dates; plus the hours other tours already hold.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/tours/availability")
      .then((r) => (r.ok ? r.json() : {}))
      .then((a) => {
        if (cancelled) return;
        setBooked(bookedHours(a.booked ?? []));
        if (open && tour.studentSlots?.length) setSelected(new Set(tour.studentSlots));
        else setSelected(new Set(slotsFromPattern(a.pattern ?? {}, { days: GRID_DAYS })));
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Escape closes; the page behind does not scroll while it is open.
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  const submit = async () => {
    if (!selected.size || sending) return;
    setSending(true);
    try {
      await onSubmit({ slots: [...selected].sort(), note: note.trim() });
    } finally {
      setSending(false);
    }
  };

  const name = listing?.title || listing?.address || "this place";
  const photo = Array.isArray(listing?.images) ? listing.images[0] : null;
  const user = session?.user ?? {};
  const disabled = busy || sending || loading || !selected.size;

  return createPortal(
    <div className="fixed inset-0 z-[300] flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-dialog-title"
        onClick={(e) => e.stopPropagation()}
        className="relative flex w-full max-w-xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl"
      >
        <button type="button" onClick={onClose} aria-label="Close" className="absolute right-4 top-4 z-10 rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700">
          <X className="h-5 w-5" />
        </button>

        <div className="px-5 pb-3 pt-4 sm:px-7 sm:pt-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">
            {open ? "Change your tour times" : confirmed ? "Request another time" : "Request a tour"}
          </p>
          <h2 id="tour-dialog-title" className="mt-1.5 pr-8 text-xl font-bold leading-tight text-gray-900 sm:text-[26px]">
            When can you tour <span className="text-red-600">{name}</span>?
          </h2>

          <div className="mt-3 flex items-center gap-3 rounded-xl border border-gray-200 p-2.5">
            {photo ? (
              <img src={photo} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover" />
            ) : (
              <div className="h-10 w-10 shrink-0 rounded-lg bg-gray-100" />
            )}
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-gray-900">{name}</p>
              {listing?.title && listing?.address && <p className="truncate text-xs text-gray-500">{listing.address}</p>}
            </div>
          </div>

          <div className="mt-3">
            <Label right={<span className="text-[11px] font-medium text-gray-500">{selected.size} hour{selected.size === 1 ? "" : "s"} selected</span>}>
              Times that work, your time ({zoneAbbrev()})
            </Label>
            {loading ? (
              <div className="h-[260px] animate-pulse rounded-lg bg-gray-100 [@media(min-height:820px)]:h-[320px]" />
            ) : (
              <>
                <DateGrid selected={selected} onChange={setSelected} days={GRID_DAYS} booked={booked} cellClass="h-5 [@media(min-height:820px)]:h-6" />
                <p className="mt-1 text-[11px] text-gray-500">
                  Drag across the hours you can make it.{booked.size > 0 && " Grey hours are tours you already have booked."}
                </p>
              </>
            )}
          </div>

          <div className="mt-3">
            {noteOpen ? (
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-500">Note for Proxy</span>
                <textarea
                  autoFocus
                  value={note}
                  onChange={(e) => setNote(e.target.value.slice(0, 2000))}
                  rows={2}
                  placeholder="Anything to know before the tour, or a question about the place"
                  className="mt-1.5 w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-400 focus:outline-none focus:ring-0"
                />
              </label>
            ) : (
              <button type="button" onClick={() => setNoteOpen(true)} className="inline-flex items-center gap-2 text-sm text-gray-700 hover:text-gray-900">
                <Pencil className="h-4 w-4" /> Add a note for Proxy <span className="text-gray-400">(optional)</span>
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 border-t border-gray-100 px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-7 sm:py-4">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-50 text-xs font-semibold text-red-700">
              {initials(user.name, user.email)}
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-400">Booking as</p>
              <p className="truncate text-sm font-semibold text-gray-900">{user.name || user.email}</p>
              {user.name && user.email && <p className="truncate text-xs text-gray-500">{user.email}</p>}
            </div>
          </div>
          <button
            type="button"
            disabled={disabled}
            onClick={submit}
            className="h-11 shrink-0 rounded-xl bg-red-600 px-4 text-sm font-semibold sm:px-5 text-white hover:bg-red-700 disabled:opacity-40"
          >
            {sending ? "Sending..." : open ? "Update tour times" : "Send tour request"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
