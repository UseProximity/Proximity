"use client";

import { useEffect, useRef, useState } from "react";
import { recomputeFromPreferences } from "@/lib/matchmaking/questionEngine";

const FIELD_LABELS = {
  name: "Name",
  year_of_school: "Year",
  group_size: "Group size",
  budget_max: "Max rent ($/mo)",
  area: "Preferred area",
  lease_term: "Lease term",
  move_in_month: "Move-in",
  furnished: "Furnished",
  commute: "Commute",
  priorities: "Priorities",
  notes: "Other notes",
};

const sameArray = (a, b) => JSON.stringify(a ?? []) === JSON.stringify(b ?? []);

// Drag-and-drop (with arrow fallback) editor for the priority ranking. Commits
// the new order to its parent on every change.
function PriorityEditor({ order, onReorder, disabled }) {
  const [local, setLocal] = useState(order);
  const dragIndex = useRef(null);

  // Keep in sync when the server/parent hands back a (possibly re-ranked) order.
  useEffect(() => {
    if (!sameArray(local, order)) setLocal(order);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order]);

  const move = (from, to) => {
    if (to < 0 || to >= local.length || from === to) return;
    const next = [...local];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    setLocal(next);
    onReorder(next);
  };

  return (
    <div className="space-y-1 mt-1">
      {local.map((opt, i) => (
        <div
          key={opt}
          draggable={!disabled}
          onDragStart={() => (dragIndex.current = i)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => {
            if (dragIndex.current !== null) move(dragIndex.current, i);
            dragIndex.current = null;
          }}
          className={`flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-gray-700 ${
            disabled ? "opacity-60" : "cursor-grab active:cursor-grabbing"
          }`}
        >
          <span className="text-gray-300 select-none">⠿</span>
          <span className="w-4 text-red-600 font-semibold">{i + 1}</span>
          <span className="flex-1 leading-tight">{opt}</span>
          <span className="flex flex-col leading-none">
            <button
              disabled={disabled || i === 0}
              onClick={() => move(i, i - 1)}
              className="text-gray-400 hover:text-red-600 disabled:opacity-30 text-[10px]"
              aria-label="Move up"
            >
              ▲
            </button>
            <button
              disabled={disabled || i === local.length - 1}
              onClick={() => move(i, i + 1)}
              className="text-gray-400 hover:text-red-600 disabled:opacity-30 text-[10px]"
              aria-label="Move down"
            >
              ▼
            </button>
          </span>
        </div>
      ))}
    </div>
  );
}

// Compact summary of the answers Proxy has collected. Priorities are editable
// here via drag-and-drop; other answers are edited in the chat ("Edit from here").
export default function PreferencePanel({ preferences, weights, sessionId, onUpdated }) {
  const [saving, setSaving] = useState(false);

  const rows = Object.entries(preferences ?? {})
    .filter(([k, v]) => {
      if (k.startsWith("_")) return false; // internal flags
      if (v === null || v === undefined || v === "") return false;
      if (Array.isArray(v) && v.length === 0) return false;
      return FIELD_LABELS[k]; // only show known, user-facing fields
    })
    .sort(([a], [b]) => Object.keys(FIELD_LABELS).indexOf(a) - Object.keys(FIELD_LABELS).indexOf(b));

  const display = (field, value) => {
    if (field === "budget_max") return `$${value}`;
    if (Array.isArray(value)) return value.join(", ");
    return String(value);
  };

  // Reorder priorities → recompute weights from scratch (bumps are monotonic, so
  // a full replay is needed to actually lower a de-prioritized dimension), then
  // persist + re-rank via PATCH.
  const handleReorder = async (newOrder) => {
    const nextPrefs = { ...preferences, priorities: newOrder };
    delete nextPrefs._priorities_unsure;
    const { weights: nextWeights } = recomputeFromPreferences(nextPrefs);

    if (!sessionId) {
      onUpdated?.({ preferences: nextPrefs, weights: nextWeights });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/matchmaking/chat", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, patch: { priorities: newOrder }, weights: nextWeights }),
      });
      const data = await res.json();
      if (res.ok) onUpdated?.(data);
    } catch (err) {
      console.error("[PreferencePanel] reorder failed:", err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100">
        <h2 className="text-sm font-semibold text-gray-900">Your answers</h2>
        <p className="text-[11px] text-gray-400 mt-0.5">
          Drag to re-rank priorities. Use “Edit from here” in the chat to change anything else.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-2">
        {rows.length === 0 ? (
          <p className="text-xs text-gray-400 py-4 text-center">No answers collected yet.</p>
        ) : (
          rows.map(([field, value]) =>
            field === "priorities" && Array.isArray(value) ? (
              <div key={field} className="py-2 border-b border-gray-50 last:border-0">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500">{FIELD_LABELS[field]}</span>
                  {saving && <span className="text-[10px] text-gray-400">Updating matches…</span>}
                </div>
                <PriorityEditor order={value} onReorder={handleReorder} disabled={saving} />
              </div>
            ) : (
              <div
                key={field}
                className="flex items-start justify-between py-2 border-b border-gray-50 last:border-0 gap-2"
              >
                <span className="text-xs text-gray-500 w-28 flex-shrink-0 pt-0.5">
                  {FIELD_LABELS[field] ?? field}
                </span>
                <span className="flex-1 text-right text-xs text-gray-700">{display(field, value)}</span>
              </div>
            )
          )
        )}
      </div>
    </div>
  );
}
