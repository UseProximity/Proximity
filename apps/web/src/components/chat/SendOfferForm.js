"use client";

import { useEffect, useState } from "react";
import toast from "react-hot-toast";

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

  if (!open) return null;

  const heading =
    title ||
    (mode === "broadcast"
      ? "Send offer to savers"
      : "Send an offer");

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
        className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h2 className="text-lg font-semibold text-gray-900">{heading}</h2>
          {mode === "broadcast" ? (
            <p className="text-sm text-gray-500 mt-1">
              {saverCount == null
                ? "Loading savers…"
                : saverCount === 0
                  ? "Nobody has saved this listing yet."
                  : `This will message ${saverCount} ${
                      saverCount === 1 ? "person" : "people"
                    } who saved this listing.`}
            </p>
          ) : (
            <p className="text-sm text-gray-500 mt-1">
              Propose a monthly rent. They can accept, counter, or deny.
            </p>
          )}
        </div>

        <label className="block text-sm text-gray-700">
          Proposed rent ($/mo)
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

        <label className="block text-sm text-gray-700">
          Note (optional)
          <textarea
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, 1000))}
            className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-red-400 resize-none"
            placeholder="e.g. Available for August move-in"
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
