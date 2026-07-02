"use client";

import { useEffect, useRef, useState } from "react";
import { recomputeFromPreferences } from "@/lib/matchmaking/questionEngine";
import { QUESTION_BY_ID, peopleLabel } from "@/lib/matchmaking/questionScript";

const FIELD_LABELS = {
  name: "Name",
  program: "Program",
  grad_year: "Grad year",
  group_size: "Group size",
  budget_max: "Max rent ($/mo)",
  area: "Preferred area",
  lease_term: "Lease term",
  move_in_month: "Move-in",
  furnished: "Furnished",
  priorities: "Priorities",
  notes: "Other notes",
};

// A panel field maps back to the scripted question whose options drive its editor.
const FIELD_TO_QID = {
  name: "name_confirm",
  program: "program",
  grad_year: "grad_year",
  group_size: "group_size",
  budget_max: "budget",
  area: "area",
  lease_term: "lease_term",
  move_in_month: "move_in_window",
  furnished: "furnished",
  priorities: "priorities",
  notes: "extras",
};

const CHIP =
  "px-2.5 py-1 rounded-full bg-white border border-red-300 text-red-700 text-xs font-medium hover:bg-red-50 transition disabled:opacity-50";
const CHIP_ON = "px-2.5 py-1 rounded-full bg-red-600 border border-red-600 text-white text-xs font-medium transition";
const SAVE_BTN = "px-3 py-1 rounded-full bg-red-600 text-white text-xs font-semibold disabled:opacity-40";

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
    <div className="space-y-1 mt-2">
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

// The drop-down editor for a single answer: renders that question's own options
// (chips / number / text), with an "Other" escape, and commits on choice/Save.
function FieldEditor({ field, value, onCommit, disabled }) {
  const q = QUESTION_BY_ID[FIELD_TO_QID[field]];
  const kind = q?.kind;
  const [text, setText] = useState(
    field === "budget_max" || field === "notes" || field === "name" ? String(value ?? "") : ""
  );
  const [selected, setSelected] = useState(Array.isArray(value) ? value : []);
  const [otherMode, setOtherMode] = useState(false);
  const [otherText, setOtherText] = useState("");
  // Slider editor seeds from the current value ("6+" → 6), else the question min.
  const [sliderVal, setSliderVal] = useState(() => {
    const n = parseInt(String(value ?? "").replace(/\+/g, ""), 10);
    return Number.isFinite(n) ? n : null;
  });

  if (!q) return null;

  if (kind === "slider") {
    const min = q.min ?? 1;
    const max = q.max ?? 6;
    const unit = q.unit || "";
    const current = sliderVal ?? min;
    const display = (n) => (q.plusOnMax && n >= max ? `${max}+` : String(n));
    const noun = (n) => (n === 1 ? unit : unit && `${unit}s`);
    return (
      <div className="mt-2">
        <div className="flex items-baseline gap-1.5 mb-1">
          <span className="text-lg font-semibold text-red-600">{display(current)}</span>
          {unit && <span className="text-xs text-gray-500">{noun(current)}</span>}
        </div>
        <input
          type="range"
          min={min}
          max={max}
          step={1}
          value={current}
          disabled={disabled}
          onChange={(e) => setSliderVal(Number(e.target.value))}
          className="w-full accent-red-600 disabled:opacity-50"
        />
        <div className="flex justify-between text-[10px] text-gray-400 px-px">
          {Array.from({ length: max - min + 1 }, (_, i) => (
            <span key={i}>{display(min + i)}</span>
          ))}
        </div>
        <button className={`mt-2 ${SAVE_BTN}`} disabled={disabled} onClick={() => onCommit(display(current))}>
          Save
        </button>
      </div>
    );
  }

  if (kind === "budget_max") {
    const ok = text !== "" && !Number.isNaN(Number(text));
    return (
      <div className="flex items-center gap-2 mt-2">
        <span className="text-xs text-gray-400">$</span>
        <input
          type="number"
          inputMode="numeric"
          autoFocus
          value={text}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && ok && onCommit(Number(text))}
          className="w-24 text-xs bg-white border border-gray-200 rounded px-2 py-1 outline-none disabled:opacity-50"
        />
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
        <input
          type="text"
          autoFocus
          value={text}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (!needsText || text.trim()) && onCommit(text.trim())}
          className="flex-1 min-w-0 text-xs bg-white border border-gray-200 rounded px-2 py-1 outline-none disabled:opacity-50"
        />
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
    const opts = q.options ?? [];
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
            <input
              type="text"
              autoFocus
              value={otherText}
              disabled={disabled}
              placeholder="Add your own…"
              onChange={(e) => setOtherText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addOther()}
              className="flex-1 min-w-0 text-xs bg-white border border-gray-200 rounded px-2 py-1 outline-none disabled:opacity-50"
            />
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
  const baseOpts = (q.options ?? []).filter((o) => !/^other$/i.test(o));
  const opts = [...baseOpts, ...(q.others ?? [])];
  if (otherMode) {
    return (
      <div className="flex items-center gap-2 mt-2">
        <input
          type="text"
          autoFocus
          value={otherText}
          disabled={disabled}
          placeholder="Type your answer…"
          onChange={(e) => setOtherText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && otherText.trim() && onCommit(otherText.trim())}
          className="flex-1 min-w-0 text-xs bg-white border border-gray-200 rounded px-2 py-1 outline-none disabled:opacity-50"
        />
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

  // Reorder priorities → recompute weights from scratch (bumps are monotonic, so
  // a full replay is needed to actually lower a de-prioritized dimension).
  const handleReorder = async (newOrder) => {
    const nextPrefs = { ...preferences, priorities: newOrder };
    delete nextPrefs._priorities_unsure;
    const { weights: nextWeights } = recomputeFromPreferences(nextPrefs);
    await persist({ priorities: newOrder, _priorities_unsure: false }, nextWeights);
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
                {isEditing &&
                  (field === "priorities" && Array.isArray(value) ? (
                    <PriorityEditor order={value} onReorder={handleReorder} disabled={saving} />
                  ) : (
                    <FieldEditor field={field} value={value} disabled={saving} onCommit={(v) => commitEdit(field, v)} />
                  ))}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
