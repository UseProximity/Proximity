"use client";

/*
 * Admin "Mass email" (Wyatt, 2026-11-07). Write an email once, save each wording
 * as a version, pick who it goes to and send it. Every email goes out from
 * info@useproximity.org and replies land there too.
 *
 *   left    the saved emails, and a box to start a new one
 *   Write   the email and a live preview; saving makes the next version
 *   Send    pick people (filters, already-sent flags), send a test, then send
 *   History every send of this email and how each one went
 *
 * "Listings without an account" used to sit beside them; it is now its own
 * page under Listings (components/admin/massEmail/UnownedPanel.js).
 *
 * Reads follow the dashboard's dev/prod switch; sending and saving only work on
 * this site's own database.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useUrlTab } from "@/components/admin/adminShared";
import EmailEditor from "./massEmail/EmailEditor";
import SendPanel from "./massEmail/SendPanel";
import HistoryPanel from "./massEmail/HistoryPanel";
import { api, FIELD, Notice, PRIMARY } from "./massEmail/shared";

const TABS = [
  { key: "write", label: "Write" },
  { key: "send", label: "Send" },
  { key: "history", label: "History" },
];
const TAB_KEYS = TABS.map((t) => t.key);

export default function MassEmailView({ dbTarget }) {
  const [tab, setTab] = useUrlTab(TAB_KEYS, "write");
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [newName, setNewName] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api(`/api/admin/mass-email${showArchived ? "?archived=1" : ""}`, dbTarget);
      setData(d);
      setError(null);
      setSelectedId((cur) => (cur && d.templates.some((t) => t.id === cur) ? cur : d.templates[0]?.id ?? null));
    } catch (e) {
      setError(e.message);
    }
  }, [dbTarget, showArchived]);

  useEffect(() => {
    load();
  }, [load]);

  const selected = useMemo(() => data?.templates.find((t) => t.id === selectedId) ?? null, [data, selectedId]);

  const create = async (e) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setBusy(true);
    try {
      const { template } = await api("/api/admin/mass-email", dbTarget, "POST", { name: newName });
      setNewName("");
      await load();
      setSelectedId(template.id);
      setTab("write");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const archive = async (archived) => {
    if (!selected) return;
    setBusy(true);
    try {
      await api(`/api/admin/mass-email/${selected.id}`, dbTarget, "PATCH", { archived });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (!data && !error) return <div className="py-20 text-center text-sm text-gray-400">Loading…</div>;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Mass email</h2>
        <p className="text-sm text-gray-500">From info@useproximity.org. Replies go to info@useproximity.org.</p>
      </div>

      {error && <Notice kind="error">{error}</Notice>}
      {data && !data.writable && (
        <Notice kind="warn">
          You are looking at the {data.target === "prod" ? "production" : "dev"} database from{" "}
          {data.own === "prod" ? "production" : "staging or a local copy"}. It is read-only here: save and send from{" "}
          {data.target === "prod" ? "useproximity.org" : "staging"}.
        </Notice>
      )}

      <div className="grid gap-4 md:grid-cols-[220px_1fr]">
        <aside className="space-y-3">
          <ul className="space-y-1">
            {(data?.templates ?? []).map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(t.id)}
                  className={`w-full rounded-lg px-3 py-2 text-left text-sm ${t.id === selectedId ? "bg-gray-900 text-white" : "text-gray-700 hover:bg-gray-100"}`}
                >
                  <span className="block truncate font-medium">{t.name}</span>
                  <span className={`block text-xs ${t.id === selectedId ? "text-gray-300" : "text-gray-400"}`}>
                    {t.versions.length ? `Version ${t.versions[0].version}` : "No version yet"}
                    {t.archived_at ? " · archived" : ""}
                  </span>
                </button>
              </li>
            ))}
            {!data?.templates?.length && <li className="px-3 py-2 text-sm text-gray-400">No emails yet.</li>}
          </ul>
          {data?.writable && (
            <form onSubmit={create} className="space-y-2">
              <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New email name" className={FIELD} maxLength={120} />
              <button type="submit" disabled={busy || !newName.trim()} className={`${PRIMARY} w-full`}>
                New email
              </button>
            </form>
          )}
          <label className="flex items-center gap-2 px-1 text-xs text-gray-500">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
            Show archived
          </label>
        </aside>

        <section className="min-w-0 space-y-4">
          {!selected ? (
            <Notice>Start a new email on the left.</Notice>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200">
                <div className="flex gap-1">
                  {TABS.map((t) => (
                    <button
                      key={t.key}
                      type="button"
                      onClick={() => setTab(t.key)}
                      className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${tab === t.key ? "border-red-600 text-red-600" : "border-transparent text-gray-500 hover:text-gray-800"}`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
                {data?.writable && (
                  <button type="button" disabled={busy} onClick={() => archive(!selected.archived_at)} className="pb-2 text-xs text-gray-500 hover:text-gray-800">
                    {selected.archived_at ? "Unarchive" : "Archive"}
                  </button>
                )}
              </div>
              {tab === "write" && (
                <EmailEditor key={selected.id} template={selected} dbTarget={dbTarget} writable={!!data?.writable} mrecUploaded={!!data?.mrecUploaded} onSaved={load} />
              )}
              {tab === "send" && <SendPanel key={selected.id} template={selected} dbTarget={dbTarget} writable={!!data?.writable} onSent={load} />}
              {tab === "history" && <HistoryPanel key={selected.id} template={selected} dbTarget={dbTarget} />}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
