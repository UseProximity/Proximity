"use client";

import { useEffect, useRef } from "react";
import { displayName } from "@/lib/compare/model";

/* Both slots are full and a third property wants in. Ask, don't guess. */
export default function ReplaceChooser({ candidate, names, onReplace, onCancel }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (el && !el.open) el.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      onClose={onCancel}
      onClick={(e) => e.target === ref.current && onCancel()}
      className="w-[calc(100%-2rem)] max-w-md rounded-2xl bg-white p-0 shadow-2xl backdrop:bg-black/50 backdrop:backdrop-blur-sm"
    >
      <div className="p-6">
        <h2 className="text-lg font-bold tracking-tight text-gray-900">Swap in {displayName(candidate)}?</h2>
        <p className="mt-1 text-sm text-gray-500">You already have two. Pick the one it replaces.</p>
        <div className="mt-5 grid gap-2">
          {[0, 1].map((slot) => (
            <button
              key={slot}
              type="button"
              onClick={() => onReplace(slot)}
              className="flex min-h-12 items-center justify-between rounded-xl border border-gray-200 px-4 text-left text-sm font-semibold text-gray-900 transition-colors hover:border-red-300 hover:bg-red-50/50"
            >
              <span className="truncate">{names[slot]}</span>
              <span className="text-xs font-medium text-gray-400">Replace</span>
            </button>
          ))}
          <button
            type="button"
            onClick={onCancel}
            className="mt-1 min-h-10 rounded-xl text-sm font-medium text-gray-500 hover:text-gray-900"
          >
            Keep both as they are
          </button>
        </div>
      </div>
    </dialog>
  );
}
