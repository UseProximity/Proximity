"use client";

import { useState } from "react";
import { shortId, GearButton } from "@/components/admin/adminShared";

// Small lookup tables the app joins against. Label per table = the column that
// best identifies a row.
const TABLE_META = {
  roles: { label: (r) => r.name, note: "User roles — student / landlord / admin / super" },
  home_types: { label: (r) => r.label, note: "Apartment / house / studio… ('Other' is the fallback)" },
  lease_structures: { label: (r) => r.label || r.name, note: "Lease term structures (e.g. 12-Month)" },
  interaction_types: { label: (r) => r.name, note: "Kinds of user↔listing interactions (click, save, contact)" },
  metric_types: { label: (r) => r.name, note: "Listing metric kinds (views, saves…)" },
  tags: { label: (r) => r.name, note: "Tags used by dorm reviews" },
  schools: { label: (r) => r.name, note: "Universities served (WashU is primary)" },
  locations: { label: (r) => `${r.name}${r.location_types?.name ? ` (${r.location_types.name})` : ""}`, note: "Named points used for walk times" },
};

export default function ReferenceView({ data, search, onOpenGear }) {
  const [openTable, setOpenTable] = useState(null);
  const tables = Object.keys(TABLE_META).filter((t) => Array.isArray(data?.[t]));
  const q = search.trim().toLowerCase();

  return (
    <div className="space-y-2">
      <p className="text-xs text-gray-500">
        Lookup tables the app joins against — edit with care, listings and reviews reference these by ID.
      </p>
      {tables.map((t) => {
        const meta = TABLE_META[t];
        const rows = data[t] || [];
        const filtered = q ? rows.filter((r) => (meta.label(r) || "").toLowerCase().includes(q)) : rows;
        const isOpen = openTable === t || q.length > 0;

        return (
          <div key={t} className="rounded-xl border border-gray-200 bg-white shadow-sm">
            <div
              className="flex items-center gap-3 px-4 py-2.5 cursor-pointer select-none"
              onClick={() => setOpenTable((cur) => (cur === t ? null : t))}
            >
              <svg className={`w-4 h-4 text-gray-400 transition-transform flex-shrink-0 ${isOpen ? "rotate-90" : ""}`} viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
              </svg>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 capitalize">{t.replace(/_/g, " ")}</p>
                <p className="text-[11px] text-gray-400">{meta.note}</p>
              </div>
              <span className="text-xs text-gray-400">{rows.length} rows</span>
            </div>
            {isOpen && (
              <div className="px-4 pb-3 pt-1 border-t border-gray-100 bg-gray-50/60">
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-1">
                  {filtered.map((r) => (
                    <div key={r.id} className="flex items-center gap-2 px-2 py-1 rounded bg-white border border-gray-200">
                      <span className="flex-1 text-xs text-gray-800 truncate">{meta.label(r) || <span className="italic text-gray-400">(unnamed)</span>}</span>
                      <span className="font-mono text-[10px] text-gray-300">{shortId(r.id)}</span>
                      <GearButton onClick={() => onOpenGear(t, r)} />
                    </div>
                  ))}
                  {filtered.length === 0 && <p className="text-xs text-gray-400 italic px-2 py-1">No rows match.</p>}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
