"use client";

import { useState } from "react";
import { deleteRow, prodConfirm, Badge, usePending } from "@/components/admin/adminShared";

// Columns that exist in the DB but are never read by the app — flagged so the
// admin knows editing them has no effect on the product.
// "unused"    → nothing reads it
// "derived"   → maintained by DB triggers / computed from children; edits get overwritten
// "write-only"→ collected by a form but never displayed anywhere
const FLAGGED_COLUMNS = {
  listings: {
    mongo_id: "unused",
    paused_at: "unused",
    demoted_at: "unused",
    last_verified_at: "unused",
    last_verified_by: "unused",
    last_verified_source: "unused",
    primary_landlord_id: "unused",
    school_id: "unused",
    min_rent: "derived",
    max_rent: "derived",
    min_bedrooms: "derived",
    max_bedrooms: "derived",
    min_bathrooms: "derived",
    max_bathrooms: "derived",
    min_area: "derived",
    max_area: "derived",
    lease_availability: "derived",
  },
  listing_reviews: {
    mongo_id: "unused",
    reviewer_email: "unused",
    landlord_name: "write-only",
    landlord_email: "write-only",
    landlord_phone: "write-only",
    unit_number: "write-only",
    no_landlord_contact: "write-only",
  },
  users: { mongo_id: "unused" },
  dorms: { mongo_id: "unused" },
  dorm_reviews: { mongo_id: "unused" },
  testimonials: { mongo_id: "unused" },
};

const FLAG_COLORS = { unused: "gray", derived: "purple", "write-only": "amber" };

// Never editable anywhere
const READONLY_COLS = new Set(["id", "created_at", "updated_at", "deleted_at"]);

// Never rendered (sensitive; also stripped server-side)
const HIDDEN_COLS = new Set([
  "password_hash",
  "email_verification_token",
  "email_verification_expires_at",
  "password_reset_token",
  "password_reset_expires_at",
]);

function isTimestampLike(key) {
  return key.endsWith("_at") || key === "birthday";
}

function displayValue(v) {
  if (v == null) return "";
  if (typeof v === "object") return JSON.stringify(v, null, 2);
  return String(v);
}

export default function GearModal({ table, row, schema, dbTarget, isProd, isReadOnly, onClose, onDeleted }) {
  const central = usePending();
  // Local draft edits layered on top of anything already staged for this row.
  // "Queue changes" moves them into the central store; the header Save applies them.
  const [pending, setPending] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // Merge schema columns with any extra keys present on the row (nested joins excluded)
  const schemaCols = (schema || []).filter((f) => !HIDDEN_COLS.has(f.key));
  const knownKeys = new Set(schemaCols.map((f) => f.key));
  // Extra scalar keys on the row not covered by the schema (nested join arrays/objects excluded)
  const extraCols = Object.keys(row)
    .filter((k) => !knownKeys.has(k) && !HIDDEN_COLS.has(k) && (row[k] == null || typeof row[k] !== "object"))
    .map((k) => ({ key: k, label: k.replace(/_/g, " "), type: typeof row[k] === "boolean" ? "boolean" : typeof row[k] === "number" ? "number" : "text" }));
  const cols = [...schemaCols, ...extraCols];

  const flags = FLAGGED_COLUMNS[table] || {};
  const dirtyCount = Object.keys(pending).length;

  function stagedValue(key) {
    return central?.get(table, row.id, key);
  }

  function currentValue(key) {
    if (pending[key] !== undefined) return pending[key];
    const staged = stagedValue(key);
    return staged !== undefined ? staged : row[key];
  }

  function setField(key, value) {
    setPending((prev) => {
      const next = { ...prev };
      // Revert to clean if the draft matches the original again
      if (displayValue(value) === displayValue(row[key])) delete next[key];
      else next[key] = value;
      return next;
    });
  }

  // Move local drafts into the central pending store; the header
  // "Save Changes" button is what actually writes to the database.
  function handleQueue() {
    if (dirtyCount === 0) return;
    for (const [k, v] of Object.entries(pending)) {
      let value = v;
      // Parse JSON-looking strings back into arrays/objects
      if (typeof v === "string" && (v.trim().startsWith("[") || v.trim().startsWith("{"))) {
        try { value = JSON.parse(v); } catch { /* keep raw string */ }
      } else if (v === "") {
        value = null;
      }
      central.stage(table, row.id, k, value, row[k]);
    }
    onClose();
  }

  async function handleDelete() {
    if (!confirm(`Delete this ${table} row (${row.id})?\n\nThis cannot be undone.`)) return;
    if (!prodConfirm(isProd, `Permanently delete ${table} row ${row.id}.`)) return;
    setSaving(true);
    setError(null);
    try {
      await deleteRow(table, row.id, dbTarget);
      onDeleted?.(row.id);
      onClose();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  function renderField(f) {
    const value = currentValue(f.key);
    const changed = pending[f.key] !== undefined || stagedValue(f.key) !== undefined;
    const flag = flags[f.key];
    const locked = isReadOnly || READONLY_COLS.has(f.key) || flag === "derived";

    let input;
    if (READONLY_COLS.has(f.key) || flag === "derived") {
      const display = isTimestampLike(f.key) && value ? new Date(value).toLocaleString() : displayValue(value);
      input = (
        <span className={`block px-2 py-1 text-xs break-all ${f.key === "id" ? "font-mono" : ""} text-gray-500`}>
          {display || "—"}
        </span>
      );
    } else if (f.type === "boolean") {
      input = (
        <input
          type="checkbox"
          checked={value === true}
          disabled={locked}
          onChange={(e) => setField(f.key, e.target.checked)}
          className={`w-4 h-4 mt-1 rounded accent-blue-600 ${changed ? "outline outline-2 outline-amber-400" : ""}`}
        />
      );
    } else if (f.type === "number") {
      input = (
        <input
          type="number"
          value={value == null ? "" : String(value)}
          disabled={locked}
          onChange={(e) => setField(f.key, e.target.value === "" ? null : Number(e.target.value))}
          step="any"
          className={`w-full px-2 py-1 text-xs border rounded focus:outline-none focus:border-blue-400 ${changed ? "border-amber-400 bg-amber-50" : "border-gray-300"}`}
        />
      );
    } else if (f.type === "json" || (value != null && typeof value === "object")) {
      input = (
        <textarea
          value={displayValue(value)}
          disabled={locked}
          rows={Math.min(6, Math.max(2, displayValue(value).split("\n").length))}
          onChange={(e) => setField(f.key, e.target.value)}
          className={`w-full px-2 py-1 text-xs font-mono border rounded focus:outline-none focus:border-blue-400 ${changed ? "border-amber-400 bg-amber-50" : "border-gray-300"}`}
        />
      );
    } else {
      const str = value == null ? "" : String(value);
      input = str.length > 60 ? (
        <textarea
          value={str}
          disabled={locked}
          rows={3}
          onChange={(e) => setField(f.key, e.target.value)}
          className={`w-full px-2 py-1 text-xs border rounded focus:outline-none focus:border-blue-400 ${changed ? "border-amber-400 bg-amber-50" : "border-gray-300"}`}
        />
      ) : (
        <input
          type="text"
          value={str}
          disabled={locked}
          onChange={(e) => setField(f.key, e.target.value)}
          className={`w-full px-2 py-1 text-xs border rounded focus:outline-none focus:border-blue-400 ${changed ? "border-amber-400 bg-amber-50" : "border-gray-300"}`}
        />
      );
    }

    return (
      <div key={f.key} className={flag === "unused" ? "opacity-60" : ""}>
        <div className="flex items-center gap-1.5 mb-0.5">
          <label className="text-[11px] font-medium text-gray-600 capitalize">{f.label || f.key.replace(/_/g, " ")}</label>
          {flag && (
            <Badge
              color={FLAG_COLORS[flag]}
              title={
                flag === "unused" ? "No app code reads this column"
                : flag === "derived" ? "Maintained automatically (triggers/children) — not directly editable"
                : "Collected by a form but never displayed in the app"
              }
            >
              {flag}
            </Badge>
          )}
        </div>
        {input}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative ml-auto w-full max-w-xl bg-white h-full flex flex-col shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 bg-gray-50">
          <div>
            <h2 className="text-base font-semibold text-gray-900 capitalize">{table.replace(/_/g, " ")} — full row</h2>
            <p className="text-xs font-mono text-gray-400 mt-0.5">{row.id}</p>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-200 text-gray-500">
            <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>

        {error && (
          <div className="mx-5 mt-3 px-3 py-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded">{error}</div>
        )}

        <div className="flex-1 overflow-y-auto px-5 py-4 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3 content-start">
          {cols.map(renderField)}
        </div>

        <div className="flex items-center justify-between px-5 py-4 border-t border-gray-200 bg-gray-50">
          {!isReadOnly ? (
            <button
              onClick={handleDelete}
              disabled={saving}
              className="px-3 py-2 text-xs font-medium text-red-600 border border-red-200 rounded hover:bg-red-50 disabled:opacity-40"
            >
              Delete row
            </button>
          ) : <span />}
          <div className="flex items-center gap-3">
            <button onClick={onClose} className="px-4 py-2 text-sm border border-gray-300 rounded hover:bg-gray-100">Close</button>
            {!isReadOnly && (
              <button
                onClick={handleQueue}
                disabled={saving || dirtyCount === 0}
                title="Stages these edits — apply them with the Save Changes button in the header"
                className="px-4 py-2 text-sm font-semibold bg-amber-500 hover:bg-amber-400 text-white rounded disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {dirtyCount > 0 ? `Queue ${dirtyCount} change${dirtyCount > 1 ? "s" : ""}` : "Queue changes"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
