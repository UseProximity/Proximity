"use client";

/*
 * One of the admin dashboard's plain lists, drawn from what
 * /api/admin/lists/[name] returns (lib/admin/lists.js). The server decides the
 * columns, the filters and the actions, so every list looks and behaves the
 * same. ListTabs shows several lists as tabs on one page.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { adminFetch, Badge, prodConfirm, useUrlTab } from "@/components/admin/adminShared";
import { AdminLink, ListingLink, PersonLink } from "@/components/admin/RecordLink";

const when = (iso) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

// Everything a cell says, for the page search.
function cellText(cell) {
  if (cell == null) return "";
  if (typeof cell === "string") return cell;
  return [cell.label, cell.sub, cell.text, cell.id].filter(Boolean).join(" ");
}

function Cell({ cell }) {
  if (cell == null || cell === "") return <span className="text-gray-300">·</span>;
  if (typeof cell === "string") return <span className="break-words">{cell}</span>;
  if (cell.t === "person") return <span><PersonLink id={cell.id}>{cell.label}</PersonLink>{cell.sub && <span className="block text-[11px] text-gray-500">{cell.sub}</span>}</span>;
  if (cell.t === "listing") return <ListingLink id={cell.id}>{cell.label}</ListingLink>;
  if (cell.t === "badge") return <Badge color={cell.color}>{cell.label}</Badge>;
  if (cell.t === "date") return <span className="whitespace-nowrap text-gray-600">{when(cell.at)}</span>;
  if (cell.t === "link") return <AdminLink path={cell.path} params={cell.params ?? undefined} className="whitespace-nowrap text-xs font-medium text-gray-900 underline">{cell.label}</AdminLink>;
  if (cell.t === "lines") return <span className="break-words">{cell.at && <span className="block whitespace-nowrap text-gray-600">{when(cell.at)}</span>}{cell.text}{cell.sub && <span className="block text-[11px] text-gray-500">{cell.sub}</span>}</span>;
  return null;
}

export default function ListPage({ name, dbTarget, isProd, search = "" }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState(null);
  const [busy, setBusy] = useState(null);

  const load = useCallback(async () => {
    try {
      const d = await adminFetch(`/api/admin/lists/${name}`, dbTarget);
      setData(d);
      setError(null);
      setFilter((f) => (f === null ? d.defaultFilter ?? "all" : f));
    } catch (e) {
      setError(e.message);
    }
  }, [name, dbTarget]);
  useEffect(() => { setData(null); setFilter(null); load(); }, [load]);

  const q = search.trim().toLowerCase();
  const rows = useMemo(() => {
    if (!data) return [];
    return data.rows.filter((r) => (filter === "all" || filter === null || !data.filters.length || r.filter === filter) && (!q || Object.values(r.cells).some((c) => cellText(c).toLowerCase().includes(q))));
  }, [data, filter, q]);

  async function act(row, key) {
    const action = data.actions[key];
    if (action.confirm && !confirm(action.confirm)) return;
    if (!prodConfirm(isProd, `${action.label} on the PRODUCTION database.`)) return;
    setBusy(row.id);
    try {
      await adminFetch(`/api/admin/lists/${name}`, dbTarget, { method: "POST", body: JSON.stringify({ action: key, id: row.id }) });
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  if (error && !data) return <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  if (!data) return <div className="py-16 text-center text-sm text-gray-400">Loading...</div>;

  const count = (key) => data.rows.filter((r) => r.filter === key).length;
  const hasActions = data.canAct && Object.keys(data.actions).length > 0;

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">{data.title}</h2>
        {data.note && <p className="text-sm text-gray-500">{data.note}</p>}
        {data.summary && <p className="mt-1 text-sm font-medium text-gray-800">{data.summary}</p>}
      </div>
      {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
      {data.unavailable && <p className="text-sm text-gray-500">This is not set up on this database yet.</p>}

      <div className="flex flex-wrap items-center gap-1.5">
        {data.filters.length > 0 && [{ key: "all", label: "All" }, ...data.filters].map((f) => (
          <button key={f.key} type="button" onClick={() => setFilter(f.key)} className={`rounded-full border px-2.5 py-0.5 text-xs ${filter === f.key ? "border-gray-800 bg-gray-800 text-white" : "border-gray-200 bg-white text-gray-600 hover:border-gray-300"}`}>
            {f.label} ({f.key === "all" ? data.rows.length : count(f.key)})
          </button>
        ))}
        <span className="ml-auto text-xs text-gray-500">
          {rows.length} shown{data.rows.length >= 500 ? " · newest 500 only" : ""}
        </span>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-gray-300 bg-white py-10 text-center text-sm text-gray-400">{data.rows.length === 0 ? "Nothing here." : "Nothing matches."}</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-gray-50 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
              <tr>
                {data.columns.map((c) => <th key={c.key} className="px-3 py-2">{c.label}</th>)}
                {hasActions && <th className="px-3 py-2" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((r) => (
                <tr key={r.id} className="align-top">
                  {data.columns.map((c) => <td key={c.key} className="max-w-md px-3 py-2 text-gray-800"><Cell cell={r.cells[c.key]} /></td>)}
                  {hasActions && (
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      {(r.actions ?? []).filter((k) => data.actions[k] && (!data.actions[k].ownOnly || data.ownDatabase)).map((k) => (
                        <button key={k} type="button" disabled={busy === r.id} onClick={() => act(r, k)} className="ml-2 rounded-lg border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-40">{data.actions[k].label}</button>
                      ))}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* Several lists as tabs on one page; the open tab lives in ?tab=. */
export function ListTabs({ tabs, dbTarget, isProd, search }) {
  const [tab, setTab] = useUrlTab(tabs.map((t) => t.list), tabs[0].list);
  if (tabs.length === 1) return <ListPage name={tabs[0].list} dbTarget={dbTarget} isProd={isProd} search={search} />;
  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-1 border-b border-gray-200">
        {tabs.map((t) => (
          <button key={t.list} type="button" onClick={() => setTab(t.list)} className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === t.list ? "border-gray-900 font-semibold text-gray-900" : "border-transparent text-gray-500 hover:text-gray-800"}`}>
            {t.label}
          </button>
        ))}
      </div>
      <ListPage key={tab} name={tab} dbTarget={dbTarget} isProd={isProd} search={search} />
    </div>
  );
}
