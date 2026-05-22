"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

export default function AdminExportPage() {
  const [tables, setTables] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [query, setQuery] = useState("");
  const [dbTarget, setDbTarget] = useState(undefined);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState(null);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("admin_db_target");
      if (stored === "prod" || stored === "dev") setDbTarget(stored);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setLoadError(null);
      try {
        const headers = dbTarget ? { "x-db-target": dbTarget } : {};
        const res = await fetch("/api/admin/schema", { headers });
        if (!res.ok) throw new Error(`Schema fetch failed (${res.status})`);
        const data = await res.json();
        if (!cancelled) setTables(Array.isArray(data.tables) ? data.tables : []);
      } catch (err) {
        if (!cancelled) setLoadError(err.message || "Failed to load tables");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [dbTarget]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tables;
    return tables.filter((t) => t.toLowerCase().includes(q));
  }, [tables, query]);

  function toggle(name) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }

  function selectAllVisible() {
    setSelected((prev) => {
      const next = new Set(prev);
      filtered.forEach((t) => next.add(t));
      return next;
    });
  }

  function clearAll() {
    setSelected(new Set());
  }

  async function handleExport() {
    if (selected.size === 0) return;
    setExporting(true);
    setExportError(null);
    try {
      const headers = { "Content-Type": "application/json" };
      if (dbTarget) headers["x-db-target"] = dbTarget;
      const res = await fetch("/api/admin/export", {
        method: "POST",
        headers,
        body: JSON.stringify({ tables: Array.from(selected) }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Export failed (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const disposition = res.headers.get("Content-Disposition") || "";
      const match = disposition.match(/filename="?([^"]+)"?/);
      const filename = match?.[1] || `proximity-export-${new Date().toISOString().slice(0, 10)}.xlsx`;
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(err.message || "Export failed");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <div className="bg-gray-900 text-white px-6 py-4 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold tracking-tight">Export Tables</h1>
          {dbTarget && (
            <span className={`px-2.5 py-0.5 text-xs font-bold rounded-full uppercase tracking-widest border ${
              dbTarget === "prod"
                ? "bg-red-500 border-red-400 text-white"
                : "bg-green-600 border-green-500 text-white"
            }`}>
              {dbTarget}
            </span>
          )}
        </div>
        <Link
          href="/dashboard/admin"
          className="text-sm text-gray-300 hover:text-white underline-offset-2 hover:underline"
        >
          ← Back to admin
        </Link>
      </div>

      <div className="px-6 py-5 max-w-3xl mx-auto">
        <p className="text-sm text-gray-600 mb-4">
          Pick any tables to include. The export is a single .xlsx file with one sheet per table.
          Each table is capped at 50,000 rows.
        </p>

        <div className="flex flex-wrap gap-2 mb-4 items-center">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter tables…"
            className="flex-1 min-w-[180px] border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
          <button
            onClick={selectAllVisible}
            disabled={filtered.length === 0}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded bg-white hover:bg-gray-50 disabled:opacity-40"
          >
            Select all visible
          </button>
          <button
            onClick={clearAll}
            disabled={selected.size === 0}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded bg-white hover:bg-gray-50 disabled:opacity-40"
          >
            Clear
          </button>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
          {loading ? (
            <p className="text-sm text-gray-400 py-8 text-center">Loading tables…</p>
          ) : loadError ? (
            <p className="text-sm text-red-600 py-6 px-4">{loadError}</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-gray-400 py-8 text-center">No tables match.</p>
          ) : (
            <ul className="divide-y divide-gray-100 max-h-[60vh] overflow-y-auto">
              {filtered.map((t) => {
                const checked = selected.has(t);
                return (
                  <li key={t}>
                    <label className="flex items-center gap-3 px-4 py-2 text-sm hover:bg-gray-50 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggle(t)}
                        className="w-4 h-4 accent-indigo-600"
                      />
                      <span className={checked ? "text-gray-900 font-medium" : "text-gray-700"}>{t}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-between mt-5 gap-3 flex-wrap">
          <p className="text-sm text-gray-600">
            {selected.size} selected
          </p>
          <div className="flex items-center gap-3">
            {exportError && <span className="text-sm text-red-600">{exportError}</span>}
            <button
              onClick={handleExport}
              disabled={selected.size === 0 || exporting}
              className="px-5 py-2 text-sm font-semibold bg-indigo-600 hover:bg-indigo-500 text-white rounded disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {exporting ? "Exporting…" : "Export .xlsx"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
