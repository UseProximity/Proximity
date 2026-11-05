"use client";

/*
 * Admin, Errors (Wyatt, 2026-11-03): everything that failed on the site,
 * grouped so one bug is one row with a count (lib/errors/record.js). Open
 * problems first, newest first; each opens to its message, the latest page
 * and browser, and the stack. A super can mark one resolved; if it happens
 * again it reopens and the team is emailed again.
 *
 * ?view=errors&error=<id> (the link in the alert email) opens that one.
 */
import { useEffect, useState } from "react";
import { adminFetch, Badge } from "@/components/admin/adminShared";

const when = (iso) => (iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "");

function ErrorRow({ e, open, onToggle, onChange, dbTarget }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  async function act(action) {
    setBusy(true); setErr(null);
    try {
      await adminFetch("/api/admin/errors", dbTarget, { method: "POST", body: JSON.stringify({ id: e.id, action }) });
      onChange();
    } catch (x) {
      setErr(x.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="border-b border-gray-100 last:border-b-0">
      <button type="button" onClick={onToggle} className="flex w-full items-start gap-3 px-3 py-2.5 text-left hover:bg-gray-50">
        <span className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${e.resolved_at ? "bg-gray-100 text-gray-500" : "bg-red-50 text-red-700"}`}>{e.count}×</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-gray-900">{e.where_label || "Unknown place"}</span>
          <span className="block truncate text-xs text-gray-600">{e.message}</span>
        </span>
        <span className="shrink-0 text-right text-[11px] text-gray-400">
          <span className="block">last {when(e.last_seen_at)}</span>
          <span className="block">{e.source === "browser" ? "in a browser" : "on the server"}</span>
        </span>
      </button>
      {open && (
        <div className="space-y-2 bg-gray-50 px-3 py-3 text-xs text-gray-700">
          <div className="flex flex-wrap gap-2">
            {e.resolved_at ? <Badge color="gray">resolved {when(e.resolved_at)}</Badge> : <Badge color="red">open</Badge>}
            {e.reopened_at && !e.resolved_at && <Badge color="amber">came back {when(e.reopened_at)}</Badge>}
            <Badge color="gray">first seen {when(e.first_seen_at)}</Badge>
            {e.last_alerted_at && <Badge color="blue">emailed {when(e.last_alerted_at)}</Badge>}
            {e.app_env && <Badge color="gray">{e.app_env}</Badge>}
          </div>
          <p className="whitespace-pre-wrap break-words"><span className="font-semibold">Message:</span> {e.message}</p>
          {e.sample?.url && <p><span className="font-semibold">Page:</span> {e.sample.url}</p>}
          {e.sample?.role && <p><span className="font-semibold">Signed in as:</span> {e.sample.role}</p>}
          {e.sample?.userAgent && <p className="break-words"><span className="font-semibold">Browser:</span> {e.sample.userAgent}</p>}
          {e.stack && <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-white p-2 font-mono text-[11px] text-gray-600">{e.stack}</pre>}
          <div className="flex items-center gap-3">
            {e.resolved_at ? (
              <button type="button" disabled={busy} onClick={() => act("reopen")} className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-800 disabled:opacity-50">Reopen</button>
            ) : (
              <button type="button" disabled={busy} onClick={() => act("resolve")} className="rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">Mark resolved</button>
            )}
            {err && <span className="text-red-600">{err}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

export default function ErrorsView({ search = "", dbTarget }) {
  const [status, setStatus] = useState("open");
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("error");
    if (id) { setOpenId(id); setStatus("all"); }
  }, []);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    adminFetch(`/api/admin/errors?status=${status}`, dbTarget)
      .then((d) => { if (!cancelled) setRows(Array.isArray(d) ? d : []); })
      .catch((x) => { if (!cancelled) setError(x.message); });
    return () => { cancelled = true; };
  }, [status, dbTarget, reload]);

  const q = search.trim().toLowerCase();
  const shown = (rows ?? []).filter((e) => !q || `${e.where_label} ${e.message}`.toLowerCase().includes(q));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {[["open", "Open"], ["resolved", "Resolved"], ["all", "All"]].map(([k, label]) => (
          <button key={k} type="button" onClick={() => setStatus(k)} className={`rounded-full border px-2.5 py-0.5 text-xs ${status === k ? "border-gray-800 bg-gray-800 text-white" : "border-gray-200 bg-white text-gray-600 hover:border-gray-300"}`}>
            {label}
          </button>
        ))}
        <p className="text-xs text-gray-500">
          Failures on the site, grouped. The team is emailed the first time each happens, when a resolved one comes back, and at 10, 100 and 1000 times (production only, at most once an hour each).
        </p>
      </div>
      {error ? (
        <p className="py-10 text-center text-sm text-red-600">{error}</p>
      ) : !rows ? (
        <p className="py-20 text-center text-sm text-gray-400">Loading errors…</p>
      ) : shown.length === 0 ? (
        <p className="rounded-xl border border-dashed border-gray-300 py-16 text-center text-sm text-gray-400">{status === "open" ? "Nothing broken right now." : "None."}</p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          {shown.map((e) => (
            <ErrorRow key={e.id} e={e} dbTarget={dbTarget} open={openId === e.id} onToggle={() => setOpenId(openId === e.id ? null : e.id)} onChange={() => setReload((n) => n + 1)} />
          ))}
        </div>
      )}
    </div>
  );
}
