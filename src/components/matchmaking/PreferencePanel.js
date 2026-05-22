"use client";

import { useState } from "react";

const FIELD_LABELS = {
  name: "Name",
  year_of_school: "Year",
  group_size: "Group size",
  budget_min: "Budget min ($)",
  budget_max: "Budget max ($)",
  area: "Preferred area",
  lease_term: "Lease term",
  move_in_date_earliest: "Move-in (earliest)",
  move_in_date_latest: "Move-in (latest)",
  furnished: "Furnished",
  commute: "Commute",
  priorities: "Priorities",
};

const WEIGHT_LABELS = {
  budget: "Budget",
  location: "Location",
  amenities: "Amenities",
  value: "Value",
  reviews: "Reviews",
  walkability: "Walkability",
  group_fit: "Group fit",
  lease_flexibility: "Lease flexibility",
  social: "Social",
};

function PrefRow({ field, value, onSave }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const display = Array.isArray(value) ? value.join(", ") : String(value ?? "—");

  const startEdit = () => {
    setDraft(Array.isArray(value) ? value.join(", ") : String(value ?? ""));
    setEditing(true);
  };

  const commit = () => {
    onSave(draft);
    setEditing(false);
  };

  return (
    <div className="flex items-start justify-between py-2 border-b border-gray-50 last:border-0 gap-2">
      <span className="text-xs text-gray-500 w-28 flex-shrink-0 pt-0.5">{FIELD_LABELS[field] ?? field}</span>
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && commit()}
          className="flex-1 text-xs text-gray-800 bg-red-50 border border-red-200 rounded px-1.5 py-0.5 outline-none"
        />
      ) : (
        <button
          onClick={startEdit}
          className="flex-1 text-right text-xs text-gray-700 hover:text-red-600 transition truncate"
        >
          {display}
        </button>
      )}
    </div>
  );
}

export default function PreferencePanel({ preferences, weights, sessionId, onUpdated }) {
  const [toast, setToast] = useState(null);

  const filledFields = Object.entries(preferences ?? {}).filter(([, v]) => {
    if (v === null || v === undefined || v === "") return false;
    if (Array.isArray(v) && v.length === 0) return false;
    return true;
  });

  const handleSave = async (field, rawValue) => {
    setToast("Updated — new matches loading…");
    const parsed = rawValue.includes(",")
      ? rawValue.split(",").map((s) => s.trim()).filter(Boolean)
      : rawValue;
    try {
      const res = await fetch("/api/matchmaking/chat", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, patch: { [field]: parsed } }),
      });
      if (res.ok) {
        const data = await res.json();
        onUpdated?.(data);
      }
    } catch (err) {
      console.error("[PreferencePanel] patch failed:", err);
    } finally {
      setTimeout(() => setToast(null), 2500);
    }
  };

  const weightEntries = Object.entries(weights ?? {}).filter(([, v]) => v > 0);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100">
        <h2 className="text-sm font-semibold text-gray-900">Your answers</h2>
      </div>

      {toast && (
        <div className="mx-3 mt-2 px-3 py-2 bg-red-50 border border-red-100 rounded-lg text-xs text-red-700">
          {toast}
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 py-2">
        {filledFields.length === 0 ? (
          <p className="text-xs text-gray-400 py-4 text-center">No answers collected yet.</p>
        ) : (
          filledFields.map(([field, value]) => (
            <PrefRow
              key={field}
              field={field}
              value={value}
              onSave={(v) => handleSave(field, v)}
            />
          ))
        )}

        {weightEntries.length > 0 && (
          <div className="mt-4">
            <p className="text-xs font-medium text-gray-500 mb-2">Weights (read-only)</p>
            {weightEntries
              .sort(([, a], [, b]) => b - a)
              .map(([key, val]) => (
                <div key={key} className="mb-1.5">
                  <div className="flex justify-between text-xs text-gray-500 mb-0.5">
                    <span>{WEIGHT_LABELS[key] ?? key}</span>
                    <span>{Math.round(val * 100)}%</span>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-red-400 rounded-full"
                      style={{ width: `${Math.round(val * 100)}%` }}
                    />
                  </div>
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}
