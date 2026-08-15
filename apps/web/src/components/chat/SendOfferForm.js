"use client";

import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";

/** Soft (5%), mid (10%), and stronger (20%) discount chips, rounded to whole dollars. */
const DISCOUNT_PERCENTS = [5, 10, 20];

function buildDiscountSuggestions(baseRent) {
  const base = Number(baseRent);
  if (!Number.isFinite(base) || base <= 0) return [];

  const suggestions = [];
  const seen = new Set();
  for (const pct of DISCOUNT_PERCENTS) {
    const amount = Math.max(1, Math.round(base * (1 - pct / 100)));
    if (amount >= base || seen.has(amount)) continue;
    seen.add(amount);
    suggestions.push({ pct, amount });
  }
  return suggestions;
}

/**
 * Small composer for sending a discount offer in one thread, or broadcasting
 * to all savers of a listing.
 *
 * mode: "thread" | "broadcast"
 */
export default function SendOfferForm({
  mode = "thread",
  open,
  onClose,
  onSubmit,
  defaultRent = "",
  saverCount = null,
  title,
}) {
  const [rent, setRent] = useState(
    defaultRent !== "" && defaultRent != null ? String(defaultRent) : ""
  );
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setRent(
      defaultRent !== "" && defaultRent != null ? String(defaultRent) : ""
    );
    setNote("");
    setBusy(false);
  }, [open, defaultRent]);

  const suggestions = useMemo(
    () => buildDiscountSuggestions(defaultRent),
    [defaultRent]
  );

  if (!open) return null;

  const heading =
    title ||
    (mode === "broadcast" ? "Send offer to savers" : "Make an offer");

  async function handleSubmit(e) {
    e.preventDefault();
    const proposedRent = Number(rent);
    if (!Number.isFinite(proposedRent) || proposedRent <= 0) {
      toast.error("Enter a valid monthly rent.");
      return;
    }
    if (mode === "broadcast" && saverCount === 0) {
      toast.error("No one has saved this listing yet.");
      return;
    }
    setBusy(true);
    try {
      await onSubmit({
        proposedRent,
        note: note.trim() || undefined,
      });
      onClose?.();
    } catch (err) {
      toast.error(err?.message || "Failed to send offer.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <form
        onSubmit={handleSubmit}
        className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5 space-y-3.5"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h2 className="text-lg font-semibold text-gray-900">{heading}</h2>
          {mode === "broadcast" ? (
            <p className="text-xs text-gray-500 mt-1">
              {saverCount == null
                ? "Loading savers…"
                : saverCount === 0
                  ? "Nobody has saved this listing yet."
                  : `This will message ${saverCount} ${
                      saverCount === 1 ? "person" : "people"
                    } who saved this listing.`}
            </p>
          ) : (
            <p className="text-xs text-gray-500 mt-1">
              Propose a monthly rent. They can accept, counter, or deny.
            </p>
          )}
        </div>

        <label className="block text-sm text-gray-700">
          Your offer
          <input
            type="number"
            min="1"
            step="1"
            required
            value={rent}
            onChange={(e) => setRent(e.target.value)}
            className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-red-400"
            placeholder="e.g. 1450"
          />
        </label>

        {suggestions.length > 0 ? (
          <div className="grid grid-cols-3 gap-2">
            {suggestions.map(({ pct, amount }) => {
              const selected = Number(rent) === amount;
              return (
                <button
                  key={pct}
                  type="button"
                  disabled={busy}
                  onClick={() => setRent(String(amount))}
                  aria-label={`${pct}% off — $${amount.toLocaleString()} per month`}
                  className={`h-[4.25rem] w-full flex flex-col items-center justify-center gap-1 rounded-xl border transition disabled:opacity-50 ${
                    selected
                      ? "border-red-300 bg-red-50 text-red-700"
                      : "border-gray-200 bg-white text-gray-700 hover:border-red-200 hover:text-red-600"
                  }`}
                >
                  <span className="text-sm font-bold leading-none">
                    {pct}% off
                  </span>
                  <span
                    className={`text-xs tabular-nums leading-none ${
                      selected ? "text-red-500" : "text-gray-500"
                    }`}
                  >
                    ${amount.toLocaleString()}
                  </span>
                </button>
              );
            })}
          </div>
        ) : null}

        <label className="block text-sm text-gray-700">
          Note (optional)
          <textarea
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, 1000))}
            className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-red-400 resize-none"
          />
        </label>

        <div className="flex gap-2 pt-1">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={
              busy ||
              (mode === "broadcast" && (saverCount == null || saverCount === 0))
            }
            className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold disabled:opacity-50"
          >
            {busy
              ? "Sending…"
              : mode === "broadcast"
                ? "Send to savers"
                : "Send offer"}
          </button>
        </div>
      </form>
    </div>
  );
}
