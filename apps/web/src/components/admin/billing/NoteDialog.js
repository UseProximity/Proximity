"use client";

import { useState } from "react";

const MAX_LENGTH = 2000;

/*
 * Asks the admin for the written internal note that resolving a contest or
 * voiding a charge requires. The note is stored with the action in the charge's
 * history and is never shown to the landlord.
 */
export default function NoteDialog({ title, description, confirmLabel, busy, onCancel, onSubmit }) {
  const [note, setNote] = useState("");
  const empty = note.trim().length === 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6 space-y-4" role="dialog" aria-modal="true">
        <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
        <p className="text-sm text-gray-600">{description}</p>
        <label className="block text-sm font-medium text-gray-700" htmlFor="billing-admin-note">
          Internal note (required, not shown to the landlord)
        </label>
        <textarea
          id="billing-admin-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={MAX_LENGTH}
          rows={4}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-500"
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
            onClick={() => onSubmit(note.trim())}
            className="px-4 py-2 bg-gray-900 hover:bg-gray-700 text-white text-sm font-semibold rounded-lg disabled:opacity-60"
          >
            {busy ? "Saving..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
