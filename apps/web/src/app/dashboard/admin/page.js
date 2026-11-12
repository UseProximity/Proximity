"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useSession } from "next-auth/react";
import { adminFetch, patchRow, prodConfirm, valuesEqual, PendingContext } from "@/components/admin/adminShared";
import GearModal from "@/components/admin/GearModal";
import ImageManagerPanel from "@/components/admin/ImageManagerPanel";
import ListingsView from "@/components/admin/ListingsView";
import UsersView from "@/components/admin/UsersView";
import ReviewsView from "@/components/admin/ReviewsView";
import DormsView from "@/components/admin/DormsView";
import TestimonialsView from "@/components/admin/TestimonialsView";
import ReferenceView from "@/components/admin/ReferenceView";
import ReviewInvitesView from "@/components/admin/ReviewInvitesView";
import ConversationsView from "@/components/admin/ConversationsView";
import SentEmailsView from "@/components/admin/SentEmailsView";
import MassEmailView from "@/components/admin/MassEmailView";
import ErrorsView from "@/components/admin/ErrorsView";
import BillingView from "@/components/admin/BillingView";
import AgentsView from "@/components/admin/AgentsView";
import { DEFAULT_PATH, findNavItem, hrefFor, navGroupsFor, navItemTitle, pathFromPathname, resolveLegacy } from "@/components/admin/adminNav";
import AdminSidebar from "@/components/admin/AdminSidebar";
import ViewAsMenu from "@/components/admin/ViewAsMenu";
import SystemToolsView from "@/components/admin/SystemToolsView";
import ReviewDuplicatesPanel from "@/components/admin/ReviewDuplicatesPanel";
import UnownedPanel from "@/components/admin/massEmail/UnownedPanel";

export default function AdminDashboard() {
  const { data: session, status: sessionStatus } = useSession();
  const isReadOnly = session?.user?.role === "admin";
  const isSuper = session?.user?.role === "super";
  const navGroups = useMemo(() => navGroupsFor(isSuper), [isSuper]);

  // The open page, as its address after /dashboard/admin/ (see adminNav.js).
  // null until the URL has been read, so a reload never flashes (or fetches) Listings first.
  const [path, setPath] = useState(null);
  const page = path ? findNavItem(path) : null;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");

  const [dbTarget, setDbTarget] = useState("dev");
  const isProd = dbTarget === "prod";
  // The database this site itself runs on. Pages marked "pinned" always use it.
  const [ownEnv, setOwnEnv] = useState(null);

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

  // Each page has its own address, so a reload, a shared link and the back
  // button all land on the same page. Inner tabs stay in ?tab= as before.
  useEffect(() => {
    function readAddress() {
      const current = pathFromPathname(window.location.pathname);
      let next = findNavItem(current) ? current : DEFAULT_PATH;
      // Old ?view= links (emails already sent, bookmarks) move to the new page.
      const legacy = current ? null : resolveLegacy(window.location.search);
      if (legacy) {
        next = legacy.path;
        const qs = legacy.params.toString();
        window.history.replaceState(null, "", qs ? `${hrefFor(next)}?${qs}` : hrefFor(next));
      }
      setPath(next);
      // Website sync emails link to one listing: open Listings filtered to it.
      const listing = new URLSearchParams(window.location.search).get("listing");
      if (next === "listings" && listing) setSearch(listing);
    }
    readAddress();
    window.addEventListener("popstate", readAddress);
    return () => window.removeEventListener("popstate", readAddress);
  }, []);

  function goTo(next) {
    if (next === path || !findNavItem(next)) return;
    if (!confirmDiscardForSwitch()) return;
    setPendingRows({});
    setSaveStatus(null);
    // Clear synchronously so the next render never sees the old page's data shape
    setData(null);
    setLoading(true);
    setSearch("");
    setPath(next);
    // A new page starts on its default tab with nothing open, so every param
    // (tab, thread, error...) is dropped.
    window.history.pushState(null, "", hrefFor(next));
  }

  // Load persisted db target on mount; fall back to the server's environment
  useEffect(() => {
    const stored = typeof window !== "undefined" ? localStorage.getItem("admin_db_target") : null;
    if (stored === "prod" || stored === "dev") setDbTarget(stored);
    fetch("/api/admin/db-env")
      .then((r) => r.json())
      .then((d) => {
        if (d.env !== "prod" && d.env !== "dev") return;
        setOwnEnv(d.env);
        if (stored !== "prod" && stored !== "dev") setDbTarget(d.env);
      })
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
          // Keyed by listing_id: upserts just the toggled columns
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

  // Table pages load one view from the hierarchy loader; every other page fetches its own data.
  const hierarchy = page?.hierarchy ?? null;

  const load = useCallback(async (silent = false) => {
    // Review invites are outreach, not a table of rows to browse: that view
    // fetches its own data from an endpoint that ignores the dev/prod switch.
    // Conversations are a thread list plus a thread body, two requests the
    // view makes itself (against the dev/prod switch).
    if (!path) return;
    if (!hierarchy) { setLoading(false); setError(null); return; }
    if (!silent) { setLoading(true); setData(null); }
    setError(null);
    try {
      const d = await adminFetch(`/api/admin/hierarchy/${hierarchy}`, dbTarget);
      setData(d);
    } catch (err) {
      setError(err.message);
      if (!silent) setData(null);
    } finally {
      setLoading(false);
    }
  }, [path, hierarchy, dbTarget]);

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
          {/* Small screens have no sidebar: the same pages in a picker */}
          <select
            aria-label="Admin page"
            value={path ?? ""}
            onChange={(e) => goTo(e.target.value)}
            className="md:hidden px-3 py-1.5 text-sm rounded-lg bg-white text-gray-900 border border-gray-300 focus:outline-none focus:border-blue-400 font-medium"
          >
            {navGroups.map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.items.filter((i) => !i.external).map((i) => (
                  <option key={i.path} value={i.path}>{navItemTitle(i)}</option>
                ))}
              </optgroup>
            ))}
          </select>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search this page…"
            className="w-56 px-3 py-1.5 text-sm rounded-lg bg-white/10 border border-gray-600 text-white placeholder-gray-400 focus:outline-none focus:border-gray-400"
          />
          <ViewAsMenu isProd={isProd} />
        </div>
      </div>

      {isProd && (
        <div className="px-6 py-2 bg-red-600 text-white text-xs font-semibold flex items-center gap-2">
          <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
          </svg>
          PRODUCTION DATABASE ACTIVE: all reads and writes affect real user data.
        </div>
      )}

      <div className="flex">
        <AdminSidebar groups={navGroups} activePath={path} onNavigate={goTo} />

        <main className="flex-1 min-w-0 px-6 py-5">
          <div className="max-w-6xl mx-auto">
            {error && (
              <div className="mb-4 px-4 py-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl">
                {error} <button type="button" onClick={() => load()} className="underline">retry</button>
              </div>
            )}

            {page?.pinned && ownEnv && ownEnv !== dbTarget && (
              <div className="mb-4 px-4 py-2.5 rounded-xl border border-amber-200 bg-amber-50 text-xs text-amber-900">
                This page does not follow the dev/prod switch. It always shows this site&apos;s own database, which is{" "}
                <strong>{ownEnv === "prod" ? "production" : "dev"}</strong>.
              </div>
            )}

            {!page || sessionStatus === "loading" ? null : page.superOnly && !isSuper ? (
              <p className="p-6 text-sm text-gray-500">This page is for super admins only.</p>
            ) : path === "reviews/invites" ? (
              <ReviewInvitesView search={search} />
            ) : path === "conversations" ? (
              <ConversationsView search={search} dbTarget={dbTarget} />
            ) : path === "email/sent" ? (
              <SentEmailsView search={search} dbTarget={dbTarget} />
            ) : path === "email/mass" ? (
              <MassEmailView key={dbTarget} search={search} dbTarget={dbTarget} />
            ) : path === "billing" ? (
              <BillingView key={dbTarget} search={search} dbTarget={dbTarget} />
            ) : path === "agents" ? (
              <AgentsView search={search} />
            ) : path === "system/errors" ? (
              <ErrorsView search={search} dbTarget={dbTarget} />
            ) : path === "system/tools" ? (
              <SystemToolsView dbTarget={dbTarget} isProd={isProd} />
            ) : path === "listings/unowned" ? (
              <UnownedPanel key={dbTarget} dbTarget={dbTarget} />
            ) : path === "listings/duplicates" ? (
              <ReviewDuplicatesPanel dbTarget={dbTarget} standalone />
            ) : loading ? (
              <div className="py-20 text-center text-sm text-gray-400">Loading…</div>
            ) : data ? (
              <>
                {path === "listings" && <ListingsView {...viewProps} />}
                {path === "people/users" && <UsersView {...viewProps} />}
                {path === "reviews" && <ReviewsView {...viewProps} />}
                {path === "listings/dorms" && <DormsView {...viewProps} />}
                {path === "reviews/testimonials" && <TestimonialsView {...viewProps} />}
                {path === "system/reference" && <ReferenceView {...viewProps} />}
              </>
            ) : null}
          </div>
        </main>
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
