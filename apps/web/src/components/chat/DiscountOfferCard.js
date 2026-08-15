"use client";

import { useState } from "react";

// A listing with no rent on file stores originalRent as null, and Number(null) is 0,
// so without the null/zero guard the card renders a struck-through "$0".
function formatMoney(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return `$${Math.round(n).toLocaleString()}`;
}

const STATUS_LABEL = {
  pending: "Pending",
  accepted: "Accepted",
  denied: "Denied",
  superseded: "Replaced",
};

/**
 * In-thread discount_offer card with accept / counter / deny for the other party.
 */
export default function DiscountOfferCard({
  message,
  canRespond = false,
  onRespond,
}) {
  const meta = message?.metadata ?? {};
  const status = meta.status || "pending";
  const proposed = formatMoney(meta.proposedRent);
  const original = formatMoney(meta.originalRent);
  const note = typeof meta.note === "string" ? meta.note.trim() : "";
  const isMine = !!message?.isMine;
  const showActions = canRespond && status === "pending" && !isMine;

  const [counterOpen, setCounterOpen] = useState(false);
  const [counterRent, setCounterRent] = useState("");
  const [counterNote, setCounterNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function run(action, extra = {}) {
    if (!onRespond || busy) return;
    setBusy(true);
    try {
      await onRespond(message.id, action, extra);
      setCounterOpen(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={`w-full max-w-[min(100%,20rem)] rounded-2xl border px-3.5 py-3 ${
        isMine
          ? "border-red-200 bg-red-50/80 ml-auto"
          : "border-gray-200 bg-white mr-auto shadow-sm"
      } ${String(message?.id).startsWith("temp-") ? "opacity-70" : ""}`}
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
          {isMine ? "Your offer" : "Offer"}
        </p>
        <span
          className={`text-[11px] font-medium ${
            status === "accepted"
              ? "text-green-700"
              : status === "denied"
                ? "text-red-600"
                : status === "superseded"
                  ? "text-gray-400"
                  : "text-amber-700"
          }`}
        >
          {STATUS_LABEL[status] || status}
        </span>
      </div>

      <div className="flex items-baseline gap-2 flex-wrap">
        <p className="text-xl font-bold text-gray-900 tabular-nums">
          {proposed || "—"}
          <span className="text-sm font-normal text-gray-500">/mo</span>
        </p>
        {original && original !== proposed ? (
          <p className="text-sm text-gray-400 line-through tabular-nums">
            {original}/mo
          </p>
        ) : null}
      </div>

      {note ? (
        <p className="mt-2 text-sm text-gray-600 whitespace-pre-wrap break-words">
          {note}
        </p>
      ) : null}

      {showActions && !counterOpen ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => run("accept")}
            className="flex-1 min-w-[4.5rem] py-1.5 px-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-semibold disabled:opacity-50"
          >
            Accept
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setCounterOpen(true)}
            className="flex-1 min-w-[4.5rem] py-1.5 px-2 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-800 text-xs font-semibold disabled:opacity-50"
          >
            Counter
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => run("deny")}
            className="flex-1 min-w-[4.5rem] py-1.5 px-2 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-600 text-xs font-medium disabled:opacity-50"
          >
            Deny
          </button>
        </div>
      ) : null}

      {showActions && counterOpen ? (
        <div className="mt-3 space-y-2">
          <label className="block text-xs text-gray-500">
            Your counter rent ($/mo)
            <input
              type="number"
              min="1"
              step="1"
              value={counterRent}
              onChange={(e) => setCounterRent(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm text-gray-900 outline-none focus:border-red-400"
              placeholder="e.g. 1400"
            />
          </label>
          <label className="block text-xs text-gray-500">
            Note (optional)
            <input
              type="text"
              value={counterNote}
              onChange={(e) => setCounterNote(e.target.value.slice(0, 1000))}
              className="mt-1 w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm text-gray-900 outline-none focus:border-red-400"
              placeholder="Optional message"
            />
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy || !Number(counterRent)}
              onClick={() =>
                run("counter", {
                  proposedRent: Number(counterRent),
                  note: counterNote.trim() || undefined,
                })
              }
              className="flex-1 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-semibold disabled:opacity-50"
            >
              Send counter
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setCounterOpen(false)}
              className="py-1.5 px-3 rounded-lg border border-gray-200 text-xs text-gray-600"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
