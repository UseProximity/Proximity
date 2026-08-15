"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Link from "next/link";
import { signOut, useSession } from "next-auth/react";
import { adminFetch, patchRow, prodConfirm, valuesEqual, PendingContext } from "@/components/admin/adminShared";
import GearModal from "@/components/admin/GearModal";
import ImageManagerPanel from "@/components/admin/ImageManagerPanel";
import ListingsView from "@/components/admin/ListingsView";
import UsersView from "@/components/admin/UsersView";
import DormsView from "@/components/admin/DormsView";
import TestimonialsView from "@/components/admin/TestimonialsView";
import ReferenceView from "@/components/admin/ReferenceView";

const VIEWS = [
  { key: "listings", label: "Listings" },
  { key: "users", label: "Users" },
  { key: "dorms", label: "Dorms" },
  { key: "testimonials", label: "Testimonials" },
  { key: "reference", label: "Reference data" },
];

// ─── Tools popover (walk times, View As, export) ──────────────────────────────

function ToolsMenu({ dbTarget, isProd }) {
  const [open, setOpen] = useState(false);
  const [walkStatus, setWalkStatus] = useState(null);
  const [walkRunning, setWalkRunning] = useState(false);
  const [driveStatus, setDriveStatus] = useState(null);
  const [driveRunning, setDriveRunning] = useState(false);
  const [viewAsQuery, setViewAsQuery] = useState("");
  const [viewAsResults, setViewAsResults] = useState([]);
  const timerRef = useRef(null);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  async function runWalkTimes() {
    if (isProd && !confirm("Update walk times on PRODUCTION?\n\nThis recalculates walk times for all listings in the production database.")) return;
    setWalkRunning(true);
    setWalkStatus(null);
    try {
      const data = await adminFetch("/api/admin/update-campus-walk-times", dbTarget, { method: "POST" });
      setWalkStatus(`Updated ${data.updated}/${data.total} listings${data.failed ? ` (${data.failed} failed)` : ""}`);
    } catch (err) {
      setWalkStatus(`Error: ${err.message}`);
    } finally {
      setWalkRunning(false);
    }
  }

  async function runDriveTimes() {
    if (isProd && !confirm("Update drive times on PRODUCTION?\n\nThis recalculates driving times for all listings in the production database.")) return;
    setDriveRunning(true);
    setDriveStatus(null);
    try {
      const data = await adminFetch("/api/admin/update-listing-drive-times", dbTarget, { method: "POST" });
      setDriveStatus(`Updated ${data.updated}/${data.total ?? "?"} listings${data.skipped ? ` (${data.skipped} already complete)` : ""}${data.failed ? ` (${data.failed} failed)` : ""}`);
    } catch (err) {
      setDriveStatus(`Error: ${err.message}`);
    } finally {
      setDriveRunning(false);
    }
  }

  function handleViewAsSearch(q) {
    setViewAsQuery(q);
    clearTimeout(timerRef.current);
    if (!q || q.length < 2) { setViewAsResults([]); return; }
    timerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/searchUsers?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        setViewAsResults(Array.isArray(data) ? data.slice(0, 6) : []);
      } catch {
        setViewAsResults([]);
      }
    }, 300);
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`px-3 py-1 text-xs rounded border font-medium transition-colors ${
          isProd ? "border-red-500 text-red-200 hover:bg-red-800" : "border-gray-600 text-gray-300 hover:bg-gray-700"
        }`}
      >
        Tools ▾
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-80 bg-white border border-gray-200 rounded-xl shadow-xl z-50 p-4 space-y-4 text-gray-800">
          <div>
            <p className="text-xs font-semibold text-gray-700 mb-1">View as user</p>
            <input
              type="text"
              value={viewAsQuery}
              onChange={(e) => handleViewAsSearch(e.target.value)}
              placeholder="Search by name or email…"
              className="w-full px-2 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:border-blue-400"
            />
            {viewAsResults.length > 0 && (
              <ul className="mt-1 border border-gray-100 rounded divide-y divide-gray-100 max-h-48 overflow-y-auto">
                {viewAsResults.map((u) => (
                  <li key={u.id} className="flex items-center justify-between gap-2 px-2 py-1.5">
                    <div className="min-w-0">
                      <p className="text-xs font-medium truncate">{u.name || "—"}</p>
                      <p className="text-[10px] text-gray-400 truncate">{u.email}</p>
                    </div>
                    <a
                      href={`/dashboard/view-as/${u.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[11px] px-2 py-0.5 bg-gray-800 text-white rounded hover:bg-gray-700 whitespace-nowrap"
                    >
                      View →
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <p className="text-xs font-semibold text-gray-700 mb-1">Walk times</p>
            <button
              type="button"
              onClick={runWalkTimes}
              disabled={walkRunning}
              className="px-3 py-1 text-xs border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-40"
            >
              {walkRunning ? "Updating…" : "Recalculate campus walk times"}
            </button>
            {walkStatus && <p className="mt-1 text-[11px] text-gray-500">{walkStatus}</p>}
          </div>

          <div>
            <p className="text-xs font-semibold text-gray-700 mb-1">Drive times</p>
            <button
              type="button"
              onClick={runDriveTimes}
              disabled={driveRunning}
              className="px-3 py-1 text-xs border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-40"
            >
              {driveRunning ? "Updating…" : "Backfill listing drive times"}
            </button>
            {driveStatus && <p className="mt-1 text-[11px] text-gray-500">{driveStatus}</p>}
          </div>

          <div className="pt-1 border-t border-gray-100">
            <Link href="/dashboard/admin/export" className="text-xs text-blue-600 hover:underline">
              CSV export →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function AdminDashboard() {
  const { data: session } = useSession();
  const isReadOnly = session?.user?.role === "admin";

  const [view, setView] = useState("listings");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");

  const [dbTarget, setDbTarget] = useState("dev");
  const isProd = dbTarget === "prod";

  const [schemas, setSchemas] = useState({});
  const [gear, setGear] = useState(null); // { table, row }
  const [imagePanel, setImagePanel] = useState(null); // { listingId, images }

  // ── Pending changes ──────────────────────────────────────────────────────
  // Every edit in the dashboard is staged here (shown immediately, highlighted
  // amber) and only written to the DB when "Save Changes" is clicked.
  // Shape: { "table|id": { field: stagedValue } }
  const [pendingRows, setPendingRows] = useState({});
  const [saveStatus, setSaveStatus] = useState(null);
  const [savingAll, setSavingAll] = useState(false);

  const pendingCount = Object.values(pendingRows).reduce((n, fields) => n + Object.keys(fields).length, 0);

  const pendingCtx = useMemo(() => ({
    get: (table, id, field) => pendingRows[`${table}|${id}`]?.[field],
    stage: (table, id, field, value, base) => {
      setSaveStatus(null);
      setPendingRows((prev) => {
        const key = `${table}|${id}`;
        const fields = { ...(prev[key] || {}) };
        // Editing back to the original value un-stages the field
        if (valuesEqual(value, base)) delete fields[field];
        else fields[field] = value;
        const next = { ...prev };
        if (Object.keys(fields).length > 0) next[key] = fields;
        else delete next[key];
        return next;
      });
    },
  }), [pendingRows]);

  function discardPending() {
    if (pendingCount > 0 && !confirm(`Discard ${pendingCount} unsaved change${pendingCount > 1 ? "s" : ""}?`)) return;
    setPendingRows({});
    setSaveStatus(null);
  }

  // Confirm before losing staged edits to navigation / view or DB switches
  useEffect(() => {
    if (pendingCount === 0) return;
    function beforeUnload(e) { e.preventDefault(); e.returnValue = ""; }
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [pendingCount]);

  function confirmDiscardForSwitch() {
    return pendingCount === 0 || confirm(`You have ${pendingCount} unsaved change${pendingCount > 1 ? "s" : ""}. Discard them and switch?`);
  }

  // Load persisted db target on mount; fall back to the server's environment
  useEffect(() => {
    const stored = typeof window !== "undefined" ? localStorage.getItem("admin_db_target") : null;
    if (stored === "prod" || stored === "dev") {
      setDbTarget(stored);
      return;
    }
    fetch("/api/admin/db-env")
      .then((r) => r.json())
      .then((d) => { if (d.env === "prod" || d.env === "dev") setDbTarget(d.env); })
      .catch(() => {});
  }, []);

  function toggleDbTarget() {
    const next = isProd ? "dev" : "prod";
    if (!confirmDiscardForSwitch()) return;
    if (next === "prod" && !confirm("Switch to PRODUCTION database?\n\nAll reads and writes will affect real user data. Proceed?")) return;
    setPendingRows({});
    setSaveStatus(null);
    setDbTarget(next);
    if (typeof window !== "undefined") localStorage.setItem("admin_db_target", next);
  }

  // Apply every staged change to the DB in one pass (single prod confirm).
  async function saveAll() {
    const entries = Object.entries(pendingRows);
    if (entries.length === 0 || savingAll) return;
    if (!prodConfirm(isProd, `Save ${pendingCount} change(s) across ${entries.length} row(s) to the PRODUCTION database.`)) return;
    setSavingAll(true);
    setSaveStatus(null);
    const errors = [];
    const failedKeys = new Set();

    for (const [key, fields] of entries) {
      const [table, id] = key.split("|");
      try {
        if (table === "listing_amenities" || table === "listing_utilities") {
          // Keyed by listing_id — upserts just the toggled columns
          await adminFetch(`/api/admin/${table}`, dbTarget, {
            method: "PATCH",
            body: JSON.stringify({ listing_id: id, ...fields }),
          });
        } else if (table === "listing_landlords") {
          // Replaces the junction set; server emails newly added landlords
          await adminFetch("/api/admin/listing_landlords", dbTarget, {
            method: "PATCH",
            body: JSON.stringify({ listing_id: id, user_ids: fields.user_ids || [] }),
          });
        } else {
          await patchRow(table, id, fields, dbTarget);
        }
      } catch (err) {
        failedKeys.add(key);
        errors.push(`${table.replace(/_/g, " ")} ${id.slice(0, 8)}…: ${err.message}`);
      }
    }

    // Keep only the failed rows staged so nothing is silently lost
    setPendingRows((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => failedKeys.has(k))));
    setSavingAll(false);
    if (errors.length === 0) {
      setSaveStatus({ ok: true, msg: `${pendingCount} change(s) saved.` });
    } else {
      setSaveStatus({ ok: false, msg: `${errors.length} row(s) failed (still staged): ${errors.slice(0, 3).join("; ")}` });
    }
    refresh();
  }

  // Column definitions for the gear modal (from the live DB via PostgREST spec)
  useEffect(() => {
    adminFetch("/api/admin/schema", dbTarget)
      .then((d) => setSchemas(d.schemas || {}))
      .catch(() => setSchemas({}));
  }, [dbTarget]);

  const load = useCallback(async (silent = false) => {
    if (!silent) { setLoading(true); setData(null); }
    setError(null);
    try {
      const d = await adminFetch(`/api/admin/hierarchy/${view}`, dbTarget);
      setData(d);
    } catch (err) {
      setError(err.message);
      if (!silent) setData(null);
    } finally {
      setLoading(false);
    }
  }, [view, dbTarget]);

  useEffect(() => { load(); }, [load]);

  // Silent refresh keeps expansion state after inline saves / child adds
  const refresh = useCallback(() => load(true), [load]);

  const viewProps = {
    data,
    search,
    dbTarget,
    isProd,
    isReadOnly,
    onOpenGear: (table, row) => setGear({ table, row }),
    onOpenImages: (listingId, images) => setImagePanel({ listingId, images }),
    onRefresh: refresh,
  };

  return (
    <PendingContext.Provider value={pendingCtx}>
    <div className="min-h-screen bg-gray-100">
      {/* Header */}
      <div className={`text-white px-6 py-4 flex items-center gap-3 flex-wrap sticky top-0 z-40 ${isProd ? "bg-red-950" : "bg-gray-900"}`}>
        <h1 className="text-xl font-bold tracking-tight">Admin</h1>
        <span className={`px-2.5 py-0.5 text-xs font-bold rounded-full uppercase tracking-widest border ${
          isProd ? "bg-red-500 border-red-400 text-white" : "bg-green-600 border-green-500 text-white"
        }`}>
          {isProd ? "PROD" : "DEV"}
        </span>
        <button
          type="button"
          onClick={toggleDbTarget}
          className={`px-3 py-1 text-xs rounded border font-medium transition-colors ${
            isProd ? "border-red-500 text-red-200 hover:bg-red-800" : "border-gray-600 text-gray-300 hover:bg-gray-700"
          }`}
        >
          Switch to {isProd ? "dev" : "prod"}
        </button>
        {isReadOnly && (
          <span className="px-2 py-0.5 text-[10px] font-semibold rounded bg-gray-700 text-gray-300 uppercase">read-only</span>
        )}

        {/* Staged-changes controls */}
        {pendingCount > 0 && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={saveAll}
              disabled={savingAll}
              className="px-4 py-1.5 text-sm font-bold rounded-lg bg-amber-400 hover:bg-amber-300 text-gray-900 shadow disabled:opacity-60 disabled:cursor-not-allowed animate-none"
            >
              {savingAll ? "Saving…" : `Save Changes (${pendingCount})`}
            </button>
            <button
              type="button"
              onClick={discardPending}
              disabled={savingAll}
              className="px-3 py-1.5 text-xs rounded-lg border border-gray-500 text-gray-300 hover:bg-gray-700 disabled:opacity-60"
            >
              Discard
            </button>
          </div>
        )}
        {saveStatus && (
          <span className={`text-xs font-medium ${saveStatus.ok ? "text-green-400" : "text-red-300"}`}>{saveStatus.msg}</span>
        )}

        <div className="ml-auto flex items-center gap-2 flex-wrap">
          <select
            value={view}
            onChange={(e) => {
              if (!confirmDiscardForSwitch()) { e.target.value = view; return; }
              setPendingRows({});
              setSaveStatus(null);
              // Clear synchronously so the next render never sees the old view's data shape
              setData(null);
              setLoading(true);
              setView(e.target.value);
              setSearch("");
            }}
            className="px-3 py-1.5 text-sm rounded-lg bg-white text-gray-900 border border-gray-300 focus:outline-none focus:border-blue-400 font-medium"
          >
            {VIEWS.map((v) => (
              <option key={v.key} value={v.key}>{v.label}</option>
            ))}
          </select>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search…"
            className="w-56 px-3 py-1.5 text-sm rounded-lg bg-white/10 border border-gray-600 text-white placeholder-gray-400 focus:outline-none focus:border-gray-400"
          />
          <ToolsMenu dbTarget={dbTarget} isProd={isProd} />
          <button
            type="button"
            onClick={() => signOut({ callbackUrl: "/" })}
            className="px-3 py-1.5 text-xs rounded-lg border border-gray-500 text-gray-300 hover:bg-gray-700"
          >
            Log out
          </button>
        </div>
      </div>

      {isProd && (
        <div className="px-6 py-2 bg-red-600 text-white text-xs font-semibold flex items-center gap-2">
          <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
          </svg>
          PRODUCTION DATABASE ACTIVE — all reads and writes affect real user data.
        </div>
      )}

      <div className="px-6 py-5 max-w-6xl mx-auto">
        {error && (
          <div className="mb-4 px-4 py-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl">
            {error} — <button type="button" onClick={() => load()} className="underline">retry</button>
          </div>
        )}

        {loading ? (
          <div className="py-20 text-center text-sm text-gray-400">Loading {view}…</div>
        ) : data ? (
          <>
            {view === "listings" && <ListingsView {...viewProps} />}
            {view === "users" && <UsersView {...viewProps} />}
            {view === "dorms" && <DormsView {...viewProps} />}
            {view === "testimonials" && <TestimonialsView {...viewProps} />}
            {view === "reference" && <ReferenceView {...viewProps} />}
          </>
        ) : null}
      </div>

      {gear && (
        <GearModal
          table={gear.table}
          row={gear.row}
          schema={schemas[gear.table] || []}
          dbTarget={dbTarget}
          isProd={isProd}
          isReadOnly={isReadOnly}
          onClose={() => setGear(null)}
          onDeleted={refresh}
        />
      )}

      {imagePanel && (
        <ImageManagerPanel
          listingId={imagePanel.listingId}
          initialImages={imagePanel.images}
          dbTarget={dbTarget}
          isProd={isProd}
          onClose={() => setImagePanel(null)}
          onSaved={() => { setImagePanel(null); refresh(); }}
        />
      )}
    </div>
    </PendingContext.Provider>
  );
}
