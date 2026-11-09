"use client";

import { useState } from "react";
import { formatCents } from "@/lib/billing/money";

const MAX_LENGTH = 2000;

export default function ContestChargeModal({ charge, busy, onCancel, onSubmit }) {
  const [reason, setReason] = useState("");
  const empty = reason.trim().length === 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6 space-y-4" role="dialog" aria-modal="true">
        <h3 className="text-lg font-semibold text-gray-900">Contest this charge?</h3>
        <p className="text-sm text-gray-600">
          You are contesting the full {formatCents(charge.amountCents)} charge for {charge.triggerLabel.toLowerCase()}.
          It will not be collected while we review it, and we will email you the outcome.
        </p>
        <label className="block text-sm font-medium text-gray-700" htmlFor="contest-reason">
          Why are you contesting it?
        </label>
        <textarea
          id="contest-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={MAX_LENGTH}
          rows={4}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
          placeholder="Tell us what looks wrong"
        />
        <div className="flex gap-2 justify-end">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="px-4 py-2 border border-gray-300 text-gray-700 hover:bg-gray-50 text-sm font-medium rounded-lg disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy || empty}
            onClick={() => onSubmit(reason.trim())}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold rounded-lg disabled:opacity-60"
          >
            {busy ? "Submitting..." : "Contest charge"}
          </button>
        </div>
      </div>
    </div>
  );
}
