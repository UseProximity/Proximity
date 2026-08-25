"use client";

/*
 * Lease lengths a landlord will accept.
 *
 * unit_leases.lease_term_months is an array because one offering is often
 * flexible — [4, 12] is a single lease the landlord will write for either a
 * semester or a year, not two listings. So this is a multi-select, and the
 * browse filter matches a listing when ANY of its lengths fits.
 *
 * The presets are the lengths that actually occur around campus; the free entry
 * exists because they are not the only ones, and a landlord offering 18 months
 * should not have to round to something untrue.
 */

import { useState } from "react";
import { Plus, Check, X } from "lucide-react";

const PRESETS = [4, 6, 10, 12, 24];

export default function LeaseTermPicker({ value = [], onChange, disabled }) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");

  const toggle = (m) =>
    onChange(value.includes(m) ? value.filter((x) => x !== m) : [...value, m].sort((a, b) => a - b));

  const addCustom = () => {
    const n = parseInt(draft, 10);
    setDraft("");
    setAdding(false);
    if (!Number.isFinite(n) || n < 1 || n > 60) return;
    if (!value.includes(n)) onChange([...value, n].sort((a, b) => a - b));
  };

  // Anything chosen that isn't a preset, so a custom length stays visible and
  // removable rather than disappearing into the array.
  const extras = value.filter((m) => !PRESETS.includes(m));

  return (
    <div className="flex flex-wrap gap-1.5">
      {PRESETS.map((m) => {
        const on = value.includes(m);
        return (
          <button
            key={m} type="button" disabled={disabled} onClick={() => toggle(m)}
            className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition ${
              on ? "bg-red-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            } ${disabled ? "cursor-default opacity-70" : ""}`}
          >
            {m} months
          </button>
        );
      })}

      {extras.map((m) => (
        <span key={m}
          className="inline-flex items-center gap-1 rounded-full bg-red-600 px-3.5 py-1.5 text-xs font-medium text-white">
          {m} months
          {!disabled && (
            <button type="button" onClick={() => toggle(m)} aria-label={`Remove ${m} months`}>
              <X className="h-3 w-3" />
            </button>
          )}
        </span>
      ))}

      {!disabled && (adding ? (
        <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1">
          <input
            autoFocus type="number" min="1" max="60" value={draft}
            placeholder="18"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); addCustom(); }
              if (e.key === "Escape") { setDraft(""); setAdding(false); }
            }}
            className="w-14 bg-transparent text-xs focus:outline-none"
          />
          <span className="text-xs text-gray-500">mo</span>
          <button type="button" onClick={addCustom} aria-label="Add lease length">
            <Check className="h-3.5 w-3.5 text-green-600" />
          </button>
        </span>
      ) : (
        <button
          type="button" onClick={() => setAdding(true)}
          className="inline-flex items-center gap-1 rounded-full border border-dashed border-gray-300 px-3.5 py-1.5 text-xs text-gray-500 transition hover:border-red-300 hover:text-red-600"
        >
          <Plus className="h-3 w-3" /> Other
        </button>
      ))}
    </div>
  );
}
