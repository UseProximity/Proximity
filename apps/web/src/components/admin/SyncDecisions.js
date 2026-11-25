"use client";

/*
 * Admin: what the website sync decided (Wyatt, 2026-11-24). Every change of
 * the last days with the source and score behind it, whether it applied and
 * why, and what the other version (the rules, or the scores) would have done
 * with the same change. Borderline calls first: the ones that only just
 * applied or only just missed. Apply now and Undo overrule one decision.
 */
import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { ListingLink } from "@/components/admin/RecordLink";

const FILTERS = [["borderline", "Borderline"], ["not_applied", "Not applied"], ["applied", "Applied"], ["differs", "Rules and scores disagree"], ["all", "All"]];
const pct = (n) => (n == null ? "" : Number(n).toFixed(2));
const when = (iso) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

const STATUS = {
  applied: ["Applied", "bg-emerald-50 text-emerald-700"],
  not_applied: ["Not applied", "bg-amber-50 text-amber-800"],
  undone: ["Undone", "bg-gray-100 text-gray-600"],
};

function Row({ r, busy, act, readOnly }) {
  const [label, tone] = STATUS[r.status];
  const other = r.decidedBy === "scores" ? r.rules : r.scoring;
  const otherName = r.decidedBy === "scores" ? "The old rules" : "The new scoring";
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-gray-900">{r.change.title}</span>
        <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${tone}`}>{label}</span>
        {r.borderline && <span className="rounded bg-violet-50 px-1.5 py-0.5 text-xs font-medium text-violet-700">Borderline</span>}
        {r.byPerson && <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">by a person</span>}
        <span className="ml-auto text-xs text-gray-500">{when(r.at)}</span>
      </div>
      {r.change.rows.length > 0 && (
        <ul className="mt-1 space-y-0.5 text-gray-700">
          {r.change.rows.map((x) => (
            <li key={x.label}>{x.label}: {x.before != null && <><span className="text-gray-500 line-through">{x.before}</span> to </>}<span className="font-medium">{x.after}</span></li>
          ))}
        </ul>
      )}
      <dl className="mt-2 grid gap-x-4 gap-y-0.5 text-xs text-gray-600 sm:grid-cols-2">
        {r.source && <div><dt className="inline text-gray-500">Read from: </dt><dd className="inline">{r.source}{r.platform ? ` (${r.platform})` : ""}</dd></div>}
        {r.score != null && <div><dt className="inline text-gray-500">Score: </dt><dd className="inline tabular-nums">{pct(r.score)} of {pct(r.need)} needed</dd></div>}
        {r.parts && <div className="sm:col-span-2"><dt className="inline text-gray-500">Score parts: </dt><dd className="inline tabular-nums">source trust {pct(r.parts.trust)} · read quality {pct(r.parts.readQuality)} · right unit {pct(r.parts.rightThing)} · freshness {pct(r.parts.freshness)}{r.parts.readsInRow > 1 ? ` · seen ${r.parts.readsInRow} reads in a row` : ""}</dd></div>}
        {r.reason && <div className="sm:col-span-2"><dt className="inline text-gray-500">{r.status === "not_applied" ? "Why not: " : "Note: "}</dt><dd className="inline">{r.reason}</dd></div>}
        {other && <div className="sm:col-span-2"><dt className="inline text-gray-500">{otherName}: </dt><dd className="inline">{other.apply ? "would apply it" : `would not apply it${other.reason ? ` (${other.reason})` : ""}`}</dd></div>}
      </dl>
      {(r.canUndo || r.canApply) && (
        <div className="mt-2 flex gap-2">
          {r.canApply && <button type="button" disabled={readOnly || busy === r.id} onClick={() => act(r, "applyNow")} className="rounded-lg bg-gray-900 px-3 py-1 text-xs font-semibold text-white disabled:opacity-50">Apply now</button>}
          {r.canUndo && <button type="button" disabled={readOnly || busy === r.id} onClick={() => act(r, "undo")} className="rounded-lg border border-gray-300 px-3 py-1 text-xs text-gray-700 disabled:opacity-50">Undo</button>}
        </div>
      )}
    </div>
  );
}

/* The sync's health over the week: per platform, Jev, and how often people overrule it. */
function Health({ h }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-4 rounded-xl border border-gray-200 bg-white p-3 text-xs text-gray-700">
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 text-left">
        <span className="font-semibold text-gray-900">Last {h.days} days</span>
        <span className="tabular-nums">{h.changes.total} changes scored</span>
        <span className="tabular-nums">rules and scores disagree on {h.changes.disagree}</span>
        <span className="tabular-nums">Jev failed {Math.round(h.jev.failRate * 1000) / 10}% of {h.jev.asked}</span>
        <span className="tabular-nums">{h.overruled.undone} undone of {h.overruled.applied} applied</span>
        <span className="tabular-nums">{h.recipes.listings} listing recipes, {h.recipes.platforms} platform recipes</span>
        <span className="ml-auto underline">{open ? "Hide" : "By platform"}</span>
      </button>
      {open && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[560px] text-left tabular-nums">
            <thead><tr className="text-gray-500"><th className="py-1 pr-3 font-medium">Read by</th><th className="pr-3 font-medium">Changes</th><th className="pr-3 font-medium">Scores apply</th><th className="pr-3 font-medium">Rules apply</th><th className="pr-3 font-medium">Disagree</th><th className="pr-3 font-medium">Borderline</th><th className="font-medium">Avg read quality</th></tr></thead>
            <tbody>
              {h.byPlatform.map((p) => (
                <tr key={p.platform} className="border-t border-gray-100"><td className="py-1 pr-3">{p.platform}</td><td className="pr-3">{p.changes}</td><td className="pr-3">{p.scoringApplies}</td><td className="pr-3">{p.rulesApply}</td><td className="pr-3">{p.disagree}</td><td className="pr-3">{p.borderline}</td><td>{p.readQuality ?? ""}</td></tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-gray-500">Applied by a person after the sync left it: {h.overruled.appliedByPerson}. Recipes rebuilt: {h.recipes.rebuiltThisWindow}. Jev had no page text for {h.jev.noText}.</p>
        </div>
      )}
    </div>
  );
}

export default function SyncDecisions({ search = "", readOnly = false }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState("borderline");
  const [days, setDays] = useState(2);
  const [busy, setBusy] = useState(null);
  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/admin/agents/decisions?days=${days}`);
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error || "Could not load the sync's decisions");
      setData(d);
      setError(null);
    } catch (err) { setError(err.message); }
  }, [days]);
  useEffect(() => { load(); }, [load]);

  const act = async (row, action) => {
    setBusy(row.id);
    try {
      const r = await fetch("/api/admin/agents/decisions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, listingId: row.listingId, eventId: row.id }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error || "Could not do that");
      toast.success(action === "undo" ? "Undone" : "Applied");
      await load();
    } catch (err) { toast.error(err.message); } finally { setBusy(null); }
  };

  if (error) return <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  if (!data) return <div className="py-20 text-center text-sm text-gray-400">Loading the sync&apos;s decisions...</div>;

  const q = search.trim().toLowerCase();
  const differs = (r) => { const o = r.decidedBy === "scores" ? r.rules : r.scoring; return !!o && o.apply !== (r.status === "applied"); };
  const rows = data.rows.filter((r) => (!q || r.listing.toLowerCase().includes(q)) && (filter === "all" || (filter === "borderline" ? r.borderline : filter === "differs" ? differs(r) : r.status === filter)));
  const groups = new Map();
  for (const r of rows) {
    if (!groups.has(r.listingId)) groups.set(r.listingId, { listing: r.listing, rows: [] });
    groups.get(r.listingId).rows.push(r);
  }
  const c = data.counts;
  return (
    <div>
      <p className="mb-3 text-sm text-gray-600">
        Every change the website sync found in the last {data.days} day{data.days === 1 ? "" : "s"}, with what it was read from, its score and why it did or did not apply. Decisions are being made by <strong>{data.decidedBy === "scores" ? "the new scoring" : "the old rules"}</strong>; each row also shows what the other one would have done.
      </p>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[["Applied", c.applied], ["Not applied", c.notApplied], ["Borderline", c.borderline], ["Undone", c.undone]].map(([k, v]) => (
          <div key={k} className="rounded-xl border border-gray-200 bg-white p-3"><div className="text-xs text-gray-500">{k}</div><div className="text-lg font-semibold tabular-nums text-gray-900">{v}</div></div>
        ))}
      </div>
      {data.health && <Health h={data.health} />}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {FILTERS.map(([k, label]) => (
          <button key={k} type="button" onClick={() => setFilter(k)} className={`rounded-full border px-3 py-1 text-xs ${filter === k ? "border-gray-900 bg-gray-900 font-semibold text-white" : "border-gray-300 bg-white text-gray-700"}`}>{label}</button>
        ))}
        <label className="ml-auto flex items-center gap-2 text-xs text-gray-600">Days
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="rounded-lg border border-gray-300 bg-white px-2 py-1 text-xs">
            {[1, 2, 7, 14].map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </label>
      </div>
      {groups.size === 0 ? <p className="text-sm text-gray-500">{filter === "borderline" ? "No borderline decisions in this window." : "Nothing matches."}</p> : [...groups.entries()].map(([id, g]) => (
        <section key={id} className="mb-6">
          <h3 className="mb-2 text-sm font-semibold text-gray-900"><ListingLink id={id}>{g.listing}</ListingLink> <span className="ml-1 text-xs font-normal text-gray-500">({g.rows.length})</span></h3>
          <div className="space-y-2">{g.rows.map((r) => <Row key={r.id} r={r} busy={busy} act={act} readOnly={readOnly} />)}</div>
        </section>
      ))}
    </div>
  );
}
