"use client";

/*
 * Admin: the per-listing agents. Counts, what is waiting for the team
 * (fair-housing flags, new owners' edits), what is waiting for landlords,
 * website changes held by syncs, units and listings gone from a website,
 * and the per-listing switch (off, pilot, on). The Knowledge tab shows what
 * each listing's agent knows and its sources (AgentsKnowledgeView).
 */
import ChangeCompare from "@/components/listings/ChangeCompare";
import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import AgentsLaunchPanel from "@/components/admin/AgentsLaunchPanel";
import AgentsKnowledgeView from "@/components/admin/AgentsKnowledgeView";
import AgentChangeCard from "@/components/admin/AgentChangeCard";
import { useUrlTab } from "@/components/admin/adminShared";

const TABS = [["overview", "Launch and review"], ["knowledge", "Knowledge"]];
const TAB_KEYS = TABS.map(([k]) => k);

function Tabs({ tab, setTab }) {
  return (
    <div className="mb-6 flex gap-1 border-b border-gray-200">
      {TABS.map(([k, label]) => (
        <button key={k} type="button" onClick={() => setTab(k)} className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === k ? "border-gray-900 font-semibold text-gray-900" : "border-transparent text-gray-500 hover:text-gray-800"}`}>{label}</button>
      ))}
    </div>
  );
}

const when = (iso) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "");

function Section({ title, children, count }) {
  return (
    <section className="mb-8">
      <h3 className="mb-2 text-sm font-semibold text-gray-900">{title}{count != null ? <span className="ml-2 text-xs font-normal text-gray-500">({count})</span> : null}</h3>
      {children}
    </section>
  );
}

/* Website changes grouped by listing, each with Apply and Reject. */
function WebsiteList({ rows, busy, decide }) {
  const groups = new Map();
  for (const e of rows) {
    if (!groups.has(e.listingId)) groups.set(e.listingId, { listing: e.listing, heldBecause: e.heldBecause, rows: [] });
    groups.get(e.listingId).rows.push(e);
  }
  return (
    <div className="space-y-3">
      {[...groups.entries()].slice(0, 100).map(([id, g]) => (
        <div key={id} className="rounded-xl border border-gray-200 bg-white">
          <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-3 py-2 text-sm">
            <span className="font-medium text-gray-900">{g.listing}</span>
            <span className="text-xs text-gray-500">{g.rows.length} change{g.rows.length === 1 ? "" : "s"}{g.heldBecause ? ` · ${g.heldBecause}` : ""}</span>
          </div>
          {g.rows.map((e) => (
            <div key={e.id} className="flex items-start justify-between gap-3 px-3 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <span className="text-xs text-gray-500">{e.unit ? `${e.unit} · ` : ""}{e.kind.replace(/_/g, " ")} · {when(e.createdAt)}</span>
                {e.view ? <div className="mt-0.5"><ChangeCompare view={e.view} /></div> : null}
                {e.note && <p className="mt-1 text-[11px] text-amber-700">{e.note}</p>}
              </div>
              <div className="flex shrink-0 gap-2"><button disabled={busy === e.id} onClick={() => decide("source", e, "approve")} className="rounded-lg bg-gray-900 px-2 py-1 text-xs font-semibold text-white">Apply</button><button disabled={busy === e.id} onClick={() => decide("source", e, "reject")} className="rounded-lg border border-gray-300 px-2 py-1 text-xs">Reject</button></div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export default function AgentsView({ search = "" }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [filter, setFilter] = useState("all");
  const [tab, setTab] = useUrlTab(TAB_KEYS, "overview");

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/agents/queue");
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error || "Could not load");
      setData(d);
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const decide = async (kind, e, decision) => {
    setBusy(e.id);
    try {
      const r = await fetch("/api/admin/agents/queue", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, eventId: e.id, listingId: e.listingId, decision }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(d?.error || "Could not apply that"); return; }
      toast.success(decision === "approve" ? "Applied" : "Rejected");
      load();
    } finally {
      setBusy(null);
    }
  };

  const setStatus = async (listingId, status) => {
    const r = await fetch("/api/admin/agents/queue", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "status", listingId, status }) });
    if (!r.ok) { toast.error("Could not change the switch"); return; }
    toast.success(`Agent ${status}`);
    load();
  };

  const seed = async () => {
    setBusy("seed");
    try {
      const r = await fetch("/api/admin/agents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "seed", onlyUnseeded: true }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(d?.error || "Seed failed"); return; }
      toast.success(`Seeded ${d.result?.listings ?? 0} listings`);
      load();
    } finally {
      setBusy(null);
    }
  };

  if (tab === "knowledge") return <div><Tabs tab={tab} setTab={setTab} /><AgentsKnowledgeView search={search} /></div>;
  if (error) return <div><Tabs tab={tab} setTab={setTab} /><div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div></div>;
  if (!data) return <div><Tabs tab={tab} setTab={setTab} /><div className="py-20 text-center text-sm text-gray-400">Loading agents...</div></div>;

  const q = search.trim().toLowerCase();
  const matches = (s) => !q || String(s ?? "").toLowerCase().includes(q);
  const agents = data.agents.filter((a) => matches(a.listing) && (filter === "all" || a.status === filter));
  const teamWebsite = data.website.filter((e) => e.teamReview && matches(e.listing));
  const landlordWebsite = data.website.filter((e) => !e.teamReview);
  const c = data.counts;

  return (
    <div>
      <Tabs tab={tab} setTab={setTab} />
      <AgentsLaunchPanel onChanged={load} />
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[["Agents", Object.values(c.agents ?? {}).reduce((n, v) => n + v, 0)], ["Live (pilot + on)", (c.agents?.pilot ?? 0) + (c.agents?.on ?? 0)], ["Facts", Object.values(c.facts ?? {}).reduce((n, v) => n + v, 0)], ["Held changes", (c.open?.held ?? 0) + (c.open?.proposed ?? 0)], ["Global switch", c.enabled ? "on" : "off"]].map(([k, v]) => (
          <div key={k} className="rounded-xl border border-gray-200 bg-white p-3"><div className="text-xs text-gray-500">{k}</div><div className="text-lg font-semibold text-gray-900">{v}</div></div>
        ))}
      </div>

      <Section title="Waiting for the team" count={data.forAdmin.length}>
        {data.forAdmin.length === 0 ? <p className="text-sm text-gray-500">Nothing.</p> : data.forAdmin.map((e) => (
          <AgentChangeCard key={e.id} event={e} tone="amber" busy={busy === e.id} onDecide={(decision) => decide("fact", e, decision)} />
        ))}
      </Section>

      <Section title="Gone from a website" count={data.gone.length}>
        {data.gone.length === 0 ? <p className="text-sm text-gray-500">Nothing.</p> : data.gone.map((e) => (
          <div key={e.id} className="mb-1 text-sm text-gray-700">{e.listing}{e.unit ? ` · ${e.unit}` : ""} · {when(e.createdAt)}</div>
        ))}
      </Section>

      <Section title="Website changes waiting for the team" count={teamWebsite.length}>
        <p className="mb-2 text-xs text-gray-500">Launch review: nothing a sync finds reaches students until it is applied here. Landlords do not see these.</p>
        {teamWebsite.length === 0 ? <p className="text-sm text-gray-500">Nothing.</p> : <WebsiteList rows={teamWebsite} busy={busy} decide={decide} />}
      </Section>

      <Section title="Waiting for landlords" count={data.forLandlords.length + landlordWebsite.length}>
        {data.forLandlords.filter((e) => matches(e.listing)).map((e) => (
          <AgentChangeCard key={e.id} event={e} busy={busy === e.id} onDecide={(decision) => decide("fact", e, decision)} />
        ))}
        {landlordWebsite.filter((e) => matches(e.listing)).slice(0, 300).map((e) => (
          <div key={e.id} className="mb-1 flex items-start justify-between gap-3 rounded-lg border border-gray-100 bg-white px-3 py-2 text-sm">
            <div className="min-w-0 flex-1">
              <span className="text-xs text-gray-500">{e.listing} · {when(e.createdAt)} · from the website sync</span>
              {e.view ? (
                <div className="mt-0.5"><ChangeCompare view={e.view} /></div>
              ) : (
                <div className="text-gray-900">{e.unit ? `${e.unit}: ` : ""}{e.kind.replace(/_/g, " ")}{e.field ? ` (${e.field})` : ""}</div>
              )}
              {e.heldBecause && <p className="mt-1 text-[11px] text-amber-700">Held: {e.heldBecause}</p>}
            </div>
            <div className="flex shrink-0 gap-2"><button disabled={busy === e.id} onClick={() => decide("source", e, "approve")} className="rounded-lg bg-gray-900 px-2 py-1 text-xs font-semibold text-white">Apply</button><button disabled={busy === e.id} onClick={() => decide("source", e, "reject")} className="rounded-lg border border-gray-300 px-2 py-1 text-xs">Reject</button></div>
          </div>
        ))}
      </Section>

      <Section title="Listings" count={agents.length}>
        <div className="mb-2 flex items-center gap-2 text-xs">
          {["all", "off", "pilot", "on"].map((f) => <button key={f} onClick={() => setFilter(f)} className={`rounded-full px-3 py-1 ${filter === f ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-700"}`}>{f}</button>)}
          <button disabled={busy === "seed"} onClick={seed} className="ml-auto rounded-lg border border-gray-300 px-3 py-1 text-xs">Seed unseeded listings</button>
        </div>
        <div className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
          {agents.slice(0, 300).map((a) => (
            <div key={a.listingId} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
              <div><span className="text-gray-900">{a.listing}</span><span className="ml-2 text-xs text-gray-500">{a.published ? "" : "draft · "}seeded {when(a.seededAt) || "never"}{a.lastSyncAt ? ` · synced ${when(a.lastSyncAt)}` : ""}</span></div>
              <select value={a.status} onChange={(e) => setStatus(a.listingId, e.target.value)} className="rounded-lg border border-gray-300 px-2 py-1 text-xs">
                <option value="off">off</option><option value="pilot">pilot</option><option value="on">on</option>
              </select>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}
