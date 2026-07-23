"use client";

import { createContext, useContext } from "react";

// ─── Pending-changes store ────────────────────────────────────────────────────
// Edits made anywhere in the dashboard are staged here (and highlighted) but
// only hit the database when the user clicks "Save Changes" in the header.
// Keys are `${table}|${id}`; values are { field: stagedValue }.

export const PendingContext = createContext(null);

export function usePending() {
  return useContext(PendingContext);
}

export function valuesEqual(a, b) {
  if (Array.isArray(a) || Array.isArray(b) || (a && typeof a === "object") || (b && typeof b === "object")) {
    return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  }
  return (a ?? null) === (b ?? null);
}

// ─── API helpers ──────────────────────────────────────────────────────────────

export async function adminFetch(path, dbTarget, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "x-db-target": dbTarget,
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export function patchRow(table, id, updates, dbTarget) {
  return adminFetch(`/api/admin/${table}`, dbTarget, {
    method: "PATCH",
    body: JSON.stringify({ id, updates }),
  });
}

export function insertRow(table, fields, dbTarget) {
  return adminFetch(`/api/admin/${table}`, dbTarget, {
    method: "POST",
    body: JSON.stringify({ fields }),
  });
}

export function deleteRow(table, id, dbTarget) {
  return adminFetch(`/api/admin/${table}?id=${encodeURIComponent(id)}`, dbTarget, {
    method: "DELETE",
  });
}

// Standard confirm gate before any write against the production database
export function prodConfirm(isProd, action) {
  if (!isProd) return true;
  return confirm(`PRODUCTION: ${action}\n\nThis affects real user data. Proceed?`);
}

// ─── Display helpers ──────────────────────────────────────────────────────────

export function shortId(id) {
  return id ? `${String(id).slice(0, 8)}…` : "";
}

export function fmtDate(v) {
  if (!v) return "—";
  const d = new Date(v);
  return isNaN(d) ? String(v) : d.toLocaleDateString();
}

export function fmtMoney(v) {
  if (v == null || isNaN(Number(v))) return "—";
  return `$${Number(v).toLocaleString()}`;
}

// Human label for a lease term month-count (Semester=5, Summer=4)
export function termLabel(months) {
  if (months === 5) return "Semester";
  if (months === 4) return "Summer";
  return `${months}-month`;
}

export function Stars({ rating }) {
  const r = Number(rating) || 0;
  return (
    <span className="text-amber-500 text-xs whitespace-nowrap" title={`${r}/5`}>
      {"★".repeat(Math.round(r))}
      <span className="text-gray-300">{"★".repeat(Math.max(0, 5 - Math.round(r)))}</span>
    </span>
  );
}

export function Badge({ color = "gray", children, title }) {
  const colors = {
    gray: "bg-gray-100 text-gray-600 border-gray-200",
    green: "bg-green-50 text-green-700 border-green-200",
    red: "bg-red-50 text-red-700 border-red-200",
    amber: "bg-amber-50 text-amber-700 border-amber-200",
    blue: "bg-blue-50 text-blue-700 border-blue-200",
    purple: "bg-purple-50 text-purple-700 border-purple-200",
  };
  return (
    <span title={title} className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium rounded border whitespace-nowrap ${colors[color] || colors.gray}`}>
      {children}
    </span>
  );
}

export function GearButton({ onClick, title = "View full row" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="p-1 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-200 flex-shrink-0"
    >
      <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
      </svg>
    </button>
  );
}

export function TrashButton({ onClick, title = "Delete" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="p-1 rounded text-gray-300 hover:text-red-600 hover:bg-red-50 flex-shrink-0"
    >
      <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
      </svg>
    </button>
  );
}

// ─── Inline editors (stage into the pending store; saved from the header) ─────

export function InlineToggle({ table, id, field, value, disabled, label }) {
  const pending = usePending();
  const staged = pending?.get(table, id, field);
  const changed = staged !== undefined;
  const checked = changed ? staged === true : value === true;

  return (
    <label className={`inline-flex items-center gap-1.5 text-xs select-none ${disabled ? "opacity-50" : "cursor-pointer"}`} title={label}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => pending.stage(table, id, field, e.target.checked, value === true)}
        className={`w-3.5 h-3.5 rounded accent-blue-600 cursor-pointer disabled:cursor-not-allowed ${changed ? "outline outline-2 outline-amber-400" : ""}`}
      />
      {label && <span className={changed ? "text-amber-700 font-medium" : "text-gray-600"}>{label}</span>}
    </label>
  );
}

export function InlineNumber({ table, id, field, value, disabled, prefix, className }) {
  const pending = usePending();
  const staged = pending?.get(table, id, field);
  const changed = staged !== undefined;
  const current = changed ? staged : value;

  if (disabled) {
    return <span className={`text-xs text-gray-700 ${className || ""}`}>{prefix}{value == null ? "—" : value}</span>;
  }

  return (
    <span className="inline-flex items-center gap-0.5">
      {prefix && <span className="text-xs text-gray-500">{prefix}</span>}
      <input
        type="number"
        value={current == null ? "" : String(current)}
        onChange={(e) => {
          const next = e.target.value === "" ? null : Number(e.target.value);
          pending.stage(table, id, field, next, value ?? null);
        }}
        className={`px-1 py-0.5 text-xs border rounded focus:outline-none focus:border-blue-400 ${
          changed ? "border-amber-400 bg-amber-50" : "border-transparent hover:border-gray-300 bg-transparent"
        } ${className || "w-16"}`}
      />
    </span>
  );
}
