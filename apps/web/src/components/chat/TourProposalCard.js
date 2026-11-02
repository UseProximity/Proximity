"use client";

/*
 * Under a chat message that suggests a tour time (Wyatt, 2026-11-02): the
 * person it was suggested to can book or move the tour to it, or not; the
 * person who suggested it sees that it is waiting. See
 * lib/agents/tourProposals.js.
 */
import { useState } from "react";
import toast from "react-hot-toast";
import { CalendarDays } from "lucide-react";

export default function TourProposalCard({ messageId, proposal, mine, otherName = "them" }) {
  const [state, setState] = useState(proposal.status);
  const [busy, setBusy] = useState(false);
  const status = state ?? proposal.status;

  const answer = async (decision) => {
    setBusy(true);
    try {
      const r = await fetch(`/api/tours/proposals/${messageId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(d?.error || "Could not update the tour."); return; }
      setState(d.proposal?.status ?? (decision === "confirm" ? "confirmed" : "declined"));
      if (decision === "confirm") toast.success(`Tour ${proposal.rebook ? "moved to" : "booked for"} ${proposal.text}.`);
    } finally { setBusy(false); }
  };

  const line = (text) => (
    <p className={`mt-1 flex items-center gap-1 text-[11px] text-gray-500 ${mine ? "justify-end" : ""}`}>
      <CalendarDays className="h-3 w-3" /> {text}
    </p>
  );
  if (status === "confirmed") return line(`Tour ${proposal.rebook ? "moved to" : "booked for"} ${proposal.text}`);
  if (status === "declined") return line(`Not booked: ${proposal.text}`);
  if (status === "replaced") return null;
  if (mine) return line(`Waiting for ${otherName} to confirm ${proposal.text}`);
  return (
    <div className="mt-1.5 max-w-[72%] rounded-xl border border-gray-200 bg-white p-2.5 text-sm text-gray-800">
      <p className="flex items-center gap-1.5 font-medium">
        <CalendarDays className="h-4 w-4 text-red-600" /> {proposal.rebook ? "Move your tour to" : "Book your tour for"} {proposal.text}?
      </p>
      <div className="mt-2 flex gap-2">
        <button type="button" disabled={busy} onClick={() => answer("confirm")} className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">Confirm</button>
        <button type="button" disabled={busy} onClick={() => answer("decline")} className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 disabled:opacity-50">Not now</button>
      </div>
    </div>
  );
}
