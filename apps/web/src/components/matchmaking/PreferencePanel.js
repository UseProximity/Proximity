"use client";

import { useState } from "react";
import { recomputeFromPreferences } from "@/lib/matchmaking/questionEngine";
import { QUESTION_BY_ID, peopleLabel } from "@/lib/matchmaking/questionScript";

const FIELD_LABELS = {
  name: "Name",
  group_size: "Group size",
  budget_max: "Max rent ($/mo)",
  area: "Preferred area",
  lease_term: "Lease term",
  move_in_month: "Move-in",
  furnished: "Furnished",
  priorities: "Priorities",
  top_priority: "Top priority",
  notes: "Other notes",
};

// A panel field maps back to the scripted question whose options drive its editor.
const FIELD_TO_QID = {
  name: "name_confirm",
  group_size: "group_size",
  budget_max: "budget",
  area: "area",
  lease_term: "lease_term",
  move_in_month: "move_in_window",
  furnished: "furnished",
  priorities: "priorities",
  top_priority: "top_priority",
  notes: "extras",
};

// Same control scale as the answer chips and the chat composer (see AnswerControls).
const CHIP =
  "px-3 py-1.5 rounded-full bg-white border border-red-300 text-red-700 text-[13px] font-medium hover:bg-red-50 transition disabled:opacity-50";
const CHIP_ON = "px-3 py-1.5 rounded-full bg-red-600 border border-red-600 text-white text-[13px] font-medium transition";
const SAVE_BTN = "px-3 py-1.5 rounded-full bg-red-600 text-white text-[13px] font-semibold disabled:opacity-40";

// Same text-field treatment as the chat composer and the answer controls, sized
// to match the chips it sits beside.
const FIELD =
  "flex items-center gap-1.5 bg-gray-50 border border-gray-200 rounded-full px-3 py-1.5 transition focus-within:border-red-300 focus-within:ring-1 focus-within:ring-red-200";
const FIELD_INPUT =
  "flex-1 min-w-0 bg-transparent text-[13px] text-gray-800 placeholder-gray-400 outline-none disabled:opacity-50";

// The drop-down editor for a single answer: renders that question's own options
// (chips / number / text), with an "Other" escape, and commits on choice/Save.
// `optionsOverride` replaces the question's static options — used by
// top_priority, whose options are the student's own priority picks.
function FieldEditor({ field, value, onCommit, disabled, optionsOverride }) {
  const q = QUESTION_BY_ID[FIELD_TO_QID[field]];
  const kind = q?.kind;
  const [text, setText] = useState(
    field === "budget_max" || field === "notes" || field === "name" ? String(value ?? "") : ""
  );
  const [selected, setSelected] = useState(Array.isArray(value) ? value : []);
  const [otherMode, setOtherMode] = useState(false);
  const [otherText, setOtherText] = useState("");

  if (!q) return null;

  if (kind === "budget_max") {
    const ok = text !== "" && !Number.isNaN(Number(text));
    return (
      <div className="flex items-center gap-2 mt-2">
        <div className={`w-32 ${FIELD}`}>
          <span className="text-[13px] text-gray-400">$</span>
          <input
            type="number"
            inputMode="numeric"
            autoFocus
            value={text}
            disabled={disabled}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && ok && onCommit(Number(text))}
            className={FIELD_INPUT}
          />
        </div>
        <button className={SAVE_BTN} disabled={disabled || !ok} onClick={() => ok && onCommit(Number(text))}>
          Save
        </button>
      </div>
    );
  }

  if (kind === "open_text" || kind === "confirm_or_replace") {
    const needsText = kind === "confirm_or_replace";
    return (
      <div className="flex items-center gap-2 mt-2">
        <div className={`flex-1 min-w-0 ${FIELD}`}>
          <input
            type="text"
            autoFocus
            value={text}
            disabled={disabled}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (!needsText || text.trim()) && onCommit(text.trim())}
            className={FIELD_INPUT}
          />
        </div>
        <button
          className={SAVE_BTN}
          disabled={disabled || (needsText && !text.trim())}
          onClick={() => (!needsText || text.trim()) && onCommit(text.trim())}
        >
          Save
        </button>
      </div>
    );
  }

  if (kind === "multi") {
    const opts = optionsOverride ?? q.options ?? [];
    const customSel = selected.filter((s) => !opts.includes(s));
    const toggle = (o) => setSelected((cur) => (cur.includes(o) ? cur.filter((x) => x !== o) : [...cur, o]));
    const addOther = () => {
      const t = otherText.trim();
      if (t && !selected.includes(t)) setSelected((cur) => [...cur, t]);
      setOtherText("");
      setOtherMode(false);
    };
    return (
      <div className="mt-2">
        <div className="flex flex-wrap gap-1.5">
          {opts.map((o) => (
            <button key={o} className={selected.includes(o) ? CHIP_ON : CHIP} disabled={disabled} onClick={() => toggle(o)}>
              {o}
            </button>
          ))}
          {customSel.map((o) => (
            <button key={o} className={CHIP_ON} disabled={disabled} onClick={() => toggle(o)}>
              {o} ✕
            </button>
          ))}
          <button className={CHIP} disabled={disabled} onClick={() => setOtherMode((v) => !v)}>
            Other…
          </button>
        </div>
        {otherMode && (
          <div className="flex items-center gap-2 mt-2">
            <div className={`flex-1 min-w-0 ${FIELD}`}>
              <input
                type="text"
                autoFocus
                value={otherText}
                disabled={disabled}
                placeholder="Add your own…"
                onChange={(e) => setOtherText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addOther()}
                className={FIELD_INPUT}
              />
            </div>
            <button className={CHIP} disabled={disabled || !otherText.trim()} onClick={addOther}>
              Add
            </button>
          </div>
        )}
        <button className={`mt-2 ${SAVE_BTN}`} disabled={disabled || selected.length === 0} onClick={() => onCommit(selected)}>
          Save
        </button>
      </div>
    );
  }

  // Single-pick (choice / yes-no / month): tapping an option commits it directly.
  const baseOpts = (optionsOverride ?? q.options ?? []).filter((o) => !/^other$/i.test(o));
  const opts = [...baseOpts, ...(q.others ?? [])];
  if (otherMode) {
    return (
      <div className="flex items-center gap-2 mt-2">
        <div className={`flex-1 min-w-0 ${FIELD}`}>
          <input
            type="text"
            autoFocus
            value={otherText}
            disabled={disabled}
            placeholder="Type your answer…"
            onChange={(e) => setOtherText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && otherText.trim() && onCommit(otherText.trim())}
            className={FIELD_INPUT}
          />
        </div>
        <button className={SAVE_BTN} disabled={disabled || !otherText.trim()} onClick={() => otherText.trim() && onCommit(otherText.trim())}>
          Save
        </button>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {opts.map((o) => (
        <button key={o} className={String(value) === o ? CHIP_ON : CHIP} disabled={disabled} onClick={() => onCommit(o)}>
          {o}
        </button>
      ))}
      <button className={CHIP} disabled={disabled} onClick={() => setOtherMode(true)}>
        Something else…
      </button>
    </div>
  );
}

// Compact summary of the answers Proxy has collected. Tap any answer to drop
// down that question's options and edit it inline (priorities drag-to-rank).
export default function PreferencePanel({ preferences, weights, sessionId, onUpdated, onUpdating }) {
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(null);

  const rows = Object.entries(preferences ?? {})
    .filter(([k, v]) => {
      if (k.startsWith("_")) return false; // internal flags
      if (v === null || v === undefined || v === "") return false;
      if (Array.isArray(v) && v.length === 0) return false;
      // With one priority picked it IS the top priority (the question is skipped),
      // so showing both rows would just repeat the same answer back.
      if (k === "top_priority" && (preferences?.priorities?.length ?? 0) < 2) return false;
      return FIELD_LABELS[k]; // only show known, user-facing fields
    })
    .sort(([a], [b]) => Object.keys(FIELD_LABELS).indexOf(a) - Object.keys(FIELD_LABELS).indexOf(b));

  const display = (field, value) => {
    if (field === "budget_max") return `$${value}`;
    if (field === "group_size") return value === "No preference" ? value : peopleLabel(value);
    if (Array.isArray(value)) return value.join(", ");
    return String(value);
  };

  // Persist a preferences patch + recomputed weights, then re-rank server-side.
  const persist = async (patch, nextWeights) => {
    if (!sessionId) {
      onUpdated?.({ preferences: { ...preferences, ...patch }, weights: nextWeights });
      return;
    }
    setSaving(true);
    onUpdating?.(true); // tell the chat to show its "reloading matches" state
    try {
      const res = await fetch("/api/matchmaking/chat", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, patch, weights: nextWeights }),
      });
      const data = await res.json();
      if (res.ok) onUpdated?.(data);
    } catch (err) {
      console.error("[PreferencePanel] save failed:", err);
    } finally {
      setSaving(false);
      onUpdating?.(false);
    }
  };

  // Commit an edited answer: fold the new value into preferences, recompute the
  // weight stack from scratch, and persist just the changed keys.
  const commitEdit = async (field, rawValue) => {
    const nextPrefs = { ...preferences };
    const patch = {};
    const set = (k, v) => {
      nextPrefs[k] = v;
      patch[k] = v;
    };
    switch (field) {
      case "priorities": {
        // Orderless set (tap order carries no meaning under binary weights).
        const next = Array.isArray(rawValue) ? rawValue : [rawValue];
        set("priorities", next);
        set("_priorities_unsure", false);
        // Drop a headline anchor that's no longer among the picked priorities.
        if (preferences.top_priority && !next.includes(preferences.top_priority)) {
          set("top_priority", null);
        }
        break;
      }
      case "budget_max":
        if (rawValue === "" || rawValue == null || Number.isNaN(Number(rawValue))) {
          setEditing(null);
          return;
        }
        set("budget_max", Number(rawValue));
        set("_budget_unsure", false);
        break;
      case "notes":
        set("notes", rawValue ?? "");
        set("_extras_done", true);
        break;
      case "name":
        if (!String(rawValue).trim()) {
          setEditing(null);
          return;
        }
        set("name", String(rawValue).trim());
        set("_name_confirmed", true);
        break;
      case "area":
        set(field, Array.isArray(rawValue) ? rawValue : [rawValue]);
        break;
      default:
        set(field, rawValue);
    }
    const { weights: nextWeights } = recomputeFromPreferences(nextPrefs);
    setEditing(null);
    await persist(patch, nextWeights);
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900">Your answers</h2>
          {saving && <span className="text-[10px] text-gray-400">Updating matches…</span>}
        </div>
        <p className="text-[11px] text-gray-400 mt-0.5">Tap any answer to change it.</p>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-2">
        {rows.length === 0 ? (
          <p className="text-xs text-gray-400 py-4 text-center">No answers collected yet.</p>
        ) : (
          rows.map(([field, value]) => {
            const isEditing = editing === field;
            return (
              <div key={field} className="py-2 border-b border-gray-50 last:border-0">
                <button
                  type="button"
                  onClick={() => setEditing(isEditing ? null : field)}
                  disabled={saving}
                  className="w-full flex items-start justify-between gap-2 text-left group disabled:opacity-60"
                >
                  <span className="text-xs text-gray-500 w-24 flex-shrink-0 pt-0.5">{FIELD_LABELS[field] ?? field}</span>
                  <span className="flex-1 text-right text-xs text-gray-700 group-hover:text-red-600 transition">
                    {display(field, value)}
                  </span>
                  <svg
                    className={`w-3 h-3 mt-0.5 flex-shrink-0 text-gray-300 group-hover:text-red-500 transition-transform ${
                      isEditing ? "rotate-180" : ""
                    }`}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2.5}
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {isEditing && (
                  <FieldEditor
                    field={field}
                    value={value}
                    disabled={saving}
                    optionsOverride={field === "top_priority" ? preferences?.priorities ?? [] : undefined}
                    onCommit={(v) => commitEdit(field, v)}
                  />
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
