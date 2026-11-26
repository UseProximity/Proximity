"use client";

/*
 * Analytics > Campaign links (PRD 7.9). Admins create trackable links and QR
 * codes here, with the naming convention enforced by the form, and see each
 * link's headline numbers for the period (sessions, accounts, inquiries,
 * applications started; admin and super traffic left out). Each number opens
 * the Marketing tab of the Analytics page limited to that link.
 *
 * Unregistered src tags seen on visits are listed with a Register shortcut:
 * registering a link with that slug gives new visits the link's labels. The
 * Marketing tab's Data quality block deep-links here with ?register=<tag>.
 *
 * Pinned to this site's own database (see the API route), so it takes no
 * dbTarget.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, fmtDate } from "@/components/admin/adminShared";
import { normalizeTag } from "@/lib/marketing/tags";
import CampaignLinkDetail from "./CampaignLinkDetail";
import CampaignLinkForm from "./CampaignLinkForm";

// The Marketing tab works in weeks (4, 12, 26, 52): the nearest period that covers this one.
const WEEKS_FOR_DAYS = { 7: 4, 30: 4, 90: 12 };

/** A link's headline number, opening the Marketing tab limited to that link. */
function StatLink({ link, days, value }) {
  const weeks = WEEKS_FOR_DAYS[days] ?? 12;
  return (
    <a
      href={`/dashboard/admin/analytics?tab=marketing&weeks=${weeks}&link=${link.id}`}
      onClick={(e) => e.stopPropagation()}
      title={`Open ${link.slug} in the Marketing tab (last ${weeks} weeks)`}
      className="text-gray-900 underline decoration-gray-300 underline-offset-2 hover:text-red-700 hover:decoration-red-700"
    >
      {value}
    </a>
  );
}

const PERIODS = [7, 30, 90];
const SELECT = "rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-sm";

function readRegisterParam() {
  if (typeof window === "undefined") return "";
  return normalizeTag(new URLSearchParams(window.location.search).get("register")) || "";
}

export default function CampaignLinksView({ search = "" }) {
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [source, setSource] = useState("");
  const [campaign, setCampaign] = useState("");
  const [status, setStatus] = useState("active");
  const [selectedId, setSelectedId] = useState(null);
  const [creating, setCreating] = useState(() => readRegisterParam());
  const [creatingOpen, setCreatingOpen] = useState(() => Boolean(readRegisterParam()));

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/admin/marketing/links?days=${days}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setData(json);
    } catch (e) {
      setError(e.message);
    }
  }, [days]);

  useEffect(() => { load(); }, [load]);

  const links = useMemo(() => data?.links ?? [], [data]);
  const sources = useMemo(() => [...new Set(links.map((l) => l.source))].sort(), [links]);
  const allCampaigns = useMemo(() => [...new Set(links.map((l) => l.campaign))].sort(), [links]);
  const q = search.trim().toLowerCase();
  const shown = links.filter(
    (l) =>
      (status === "all" || l.status === status) &&
      (!source || l.source === source) &&
      (!campaign || l.campaign === campaign) &&
      (!q || `${l.name} ${l.slug} ${l.campaign} ${l.destination_path}`.toLowerCase().includes(q)),
  );
  const selected = links.find((l) => l.id === selectedId) ?? null;
  const origin = typeof window === "undefined" ? undefined : window.location.origin;

  const openCreate = (slug = "") => {
    setSelectedId(null);
    setCreating(slug);
    setCreatingOpen(true);
  };
  const closeCreate = () => {
    setCreatingOpen(false);
    setCreating("");
    const p = new URLSearchParams(window.location.search);
    if (p.has("register")) {
      p.delete("register");
      const qs = p.toString();
      window.history.replaceState(window.history.state, "", qs ? `${window.location.pathname}?${qs}` : window.location.pathname);
    }
  };

  if (error) return <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error} <button type="button" onClick={load} className="underline">retry</button></div>;
  if (!data) return <div className="py-16 text-center text-sm text-gray-400">Loading...</div>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Campaign links</h2>
          <p className="text-sm text-gray-500">Trackable links and QR codes. Every visit through a link, and what it leads to, is attributed to it.</p>
        </div>
        {!creatingOpen && (
          <button type="button" onClick={() => openCreate()} className="rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700">
            New link
          </button>
        )}
      </div>

      {creatingOpen && (
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <h3 className="mb-3 text-base font-semibold text-gray-900">{creating ? `Register "${creating}"` : "New campaign link"}</h3>
          {creating && <p className="mb-3 text-xs text-gray-500">This tag has already been seen on visits. Registering it gives new visits the link&apos;s labels; past visits are not rewritten.</p>}
          <CampaignLinkForm
            key={creating}
            initialSlug={creating}
            campaigns={data.campaigns}
            onCancel={closeCreate}
            onSaved={async (link) => { closeCreate(); await load(); setSelectedId(link.id); }}
          />
        </div>
      )}

      {selected && (
        <CampaignLinkDetail
          key={selected.id}
          link={selected}
          origin={origin}
          campaigns={data.campaigns}
          onClose={() => setSelectedId(null)}
          onChanged={async (l) => { await load(); setSelectedId(l ? l.id : null); }}
        />
      )}

      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="Period" className={SELECT} value={days} onChange={(e) => setDays(Number(e.target.value))}>
          {PERIODS.map((d) => <option key={d} value={d}>Last {d} days</option>)}
        </select>
        <select aria-label="Source" className={SELECT} value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="">All sources</option>
          {sources.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select aria-label="Campaign" className={SELECT} value={campaign} onChange={(e) => setCampaign(e.target.value)}>
          <option value="">All campaigns</option>
          {allCampaigns.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select aria-label="Status" className={SELECT} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="active">Active</option>
          <option value="archived">Archived</option>
          <option value="all">All</option>
        </select>
        <span className="text-xs text-gray-400">Use the search box above to search by name, slug, campaign or destination.</span>
      </div>

      {shown.length === 0 ? (
        <p className="rounded-xl border border-dashed border-gray-300 bg-white py-10 text-center text-sm text-gray-400">
          {links.length ? "No links match these filters." : "No campaign links yet. Create the first one above."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs font-medium text-gray-500">
              <tr>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Slug</th>
                <th className="px-3 py-2">Source</th>
                <th className="px-3 py-2">Campaign</th>
                <th className="px-3 py-2">Destination</th>
                <th className="px-3 py-2">Created</th>
                <th className="px-3 py-2 text-right">Sessions</th>
                <th className="px-3 py-2 text-right">Accounts</th>
                <th className="px-3 py-2 text-right">Inquiries</th>
                <th className="px-3 py-2 text-right">Applications</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {shown.map((l) => (
                <tr key={l.id} onClick={() => { setCreatingOpen(false); setSelectedId(l.id); }} className={`cursor-pointer hover:bg-gray-50 ${l.id === selectedId ? "bg-gray-50" : ""}`}>
                  <td className="px-3 py-2 font-medium text-gray-900">
                    {l.name} {l.status === "archived" && <Badge color="amber">Archived</Badge>}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-gray-700">{l.slug}</td>
                  <td className="px-3 py-2 text-gray-700">{l.source} <span className="text-gray-400">/ {l.medium}</span></td>
                  <td className="px-3 py-2 text-gray-700">{l.campaign}</td>
                  <td className="max-w-[12rem] truncate px-3 py-2 font-mono text-xs text-gray-500" title={l.destination_path}>{l.destination_path}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-500">{fmtDate(l.created_at)}{l.creator?.name ? ` by ${l.creator.name}` : ""}</td>
                  <td className="px-3 py-2 text-right tabular-nums"><StatLink link={l} days={days} value={l.stats.sessions} /></td>
                  <td className="px-3 py-2 text-right tabular-nums"><StatLink link={l} days={days} value={l.stats.accounts} /></td>
                  <td className="px-3 py-2 text-right tabular-nums"><StatLink link={l} days={days} value={l.stats.inquiries} /></td>
                  <td className="px-3 py-2 text-right tabular-nums"><StatLink link={l} days={days} value={l.stats.applications} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-gray-900">Unregistered tags seen (last {days} days)</h3>
        <p className="text-xs text-gray-500">
          Visits that arrived with a ?src tag matching no link, for example review QR codes printed before this page existed or a mistyped short link. They count under source qr until registered.
        </p>
        {data.unregistered.length === 0 ? (
          <p className="text-xs text-gray-400">None in this period.</p>
        ) : (
          <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
            {data.unregistered.map((t) => (
              <li key={t.tag} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
                <code className="font-mono text-xs text-gray-800">{t.tag}</code>
                <span className="text-xs text-gray-500">{t.sessions} session{t.sessions === 1 ? "" : "s"} · last seen {fmtDate(t.lastSeen)}</span>
                <button type="button" onClick={() => openCreate(t.tag)} className="ml-auto rounded-lg border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50">
                  Register
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
