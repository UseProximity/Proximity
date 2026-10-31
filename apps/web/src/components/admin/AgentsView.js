"use client";

/*
 * Admin: the per-listing agents. Counts, what is waiting for the team
 * (fair-housing flags, new owners' edits), what is waiting for landlords,
 * website changes held by syncs, units and listings gone from a website,
 * and the per-listing switch (off, pilot, on).
 */
import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";

const when = (iso) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "");

function Section({ title, children, count }) {
  return (
    <section className="mb-8">
      <h3 className="mb-2 text-sm font-semibold text-gray-900">{title}{count != null ? <span className="ml-2 text-xs font-normal text-gray-500">({count})</span> : null}</h3>
      {children}
    </section>
  );
}

export default function AgentsView({ search = "" }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [filter, setFilter] = useState("all");

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

  if (error) return <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  if (!data) return <div className="py-20 text-center text-sm text-gray-400">Loading agents...</div>;

  const q = search.trim().toLowerCase();
  const matches = (s) => !q || String(s ?? "").toLowerCase().includes(q);
  const agents = data.agents.filter((a) => matches(a.listing) && (filter === "all" || a.status === filter));
  const c = data.counts;

  return (
    <div>
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[["Agents", Object.values(c.agents ?? {}).reduce((n, v) => n + v, 0)], ["Live (pilot + on)", (c.agents?.pilot ?? 0) + (c.agents?.on ?? 0)], ["Facts", Object.values(c.facts ?? {}).reduce((n, v) => n + v, 0)], ["Held changes", (c.open?.held ?? 0) + (c.open?.proposed ?? 0)], ["Global switch", c.enabled ? "on" : "off"]].map(([k, v]) => (
          <div key={k} className="rounded-xl border border-gray-200 bg-white p-3"><div className="text-xs text-gray-500">{k}</div><div className="text-lg font-semibold text-gray-900">{v}</div></div>
        ))}
      </div>

      <Section title="Waiting for the team" count={data.forAdmin.length}>
        {data.forAdmin.length === 0 ? <p className="text-sm text-gray-500">Nothing.</p> : data.forAdmin.map((e) => (
          <div key={e.id} className="mb-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm">
            <div className="flex items-center justify-between gap-2 text-xs text-gray-600"><span>{e.listing} · {e.cause.replace(/_/g, " ")} · {when(e.createdAt)}</span>{e.flags?.length ? <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700">fair housing: {e.flags.join(", ")}</span> : e.recentClaim ? <span className="rounded-full bg-gray-200 px-2 py-0.5 text-[11px]">new owner</span> : null}</div>
            <p className="mt-1 text-gray-900">{e.summary}</p>
            <div className="mt-2 flex gap-2"><button disabled={busy === e.id} onClick={() => decide("fact", e, "approve")} className="rounded-lg bg-gray-900 px-3 py-1 text-xs font-semibold text-white">Apply</button><button disabled={busy === e.id} onClick={() => decide("fact", e, "reject")} className="rounded-lg border border-gray-300 px-3 py-1 text-xs">Reject</button></div>
          </div>
        ))}
      </Section>

      <Section title="Gone from a website" count={data.gone.length}>
        {data.gone.length === 0 ? <p className="text-sm text-gray-500">Nothing.</p> : data.gone.map((e) => (
          <div key={e.id} className="mb-1 text-sm text-gray-700">{e.listing}{e.unit ? ` · ${e.unit}` : ""} · {when(e.createdAt)}</div>
        ))}
      </Section>

      <Section title="Waiting for landlords" count={data.forLandlords.length + data.website.length}>
        {[...data.forLandlords.map((e) => ({ ...e, kind: "fact", title: e.summary })), ...data.website.map((e) => ({ ...e, kind: "source", title: `${e.unit ? `${e.unit}: ` : ""}${e.kind.replace(/_/g, " ")}${e.field ? ` (${e.field})` : ""}` }))].filter((e) => matches(e.listing)).slice(0, 100).map((e) => (
          <div key={e.id} className="mb-1 flex items-center justify-between gap-2 rounded-lg border border-gray-100 bg-white px-3 py-2 text-sm">
            <div><span className="text-xs text-gray-500">{e.listing} · {when(e.createdAt)}</span><div className="text-gray-900">{e.title}</div></div>
            <div className="flex shrink-0 gap-2"><button disabled={busy === e.id} onClick={() => decide(e.kind, e, "approve")} className="rounded-lg bg-gray-900 px-2 py-1 text-xs font-semibold text-white">Apply</button><button disabled={busy === e.id} onClick={() => decide(e.kind, e, "reject")} className="rounded-lg border border-gray-300 px-2 py-1 text-xs">Reject</button></div>
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
