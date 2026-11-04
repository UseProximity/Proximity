"use client";

/*
 * Admin, Agents, Knowledge: what each listing's agent knows and where every
 * fact came from (Wyatt, 2026-11-02). Read only, admins only, and shown
 * whether or not agents are switched on, so a listing can be checked before
 * it goes live.
 *
 *   left    every published listing with its fact and source counts
 *   right   the picked listing: facts by section, each with its source;
 *           the sources themselves; pages found by source search; recent
 *           knowledge changes
 */
import { useCallback, useEffect, useMemo, useState } from "react";

const SECTION_LABEL = { core: "Core", fees: "Fees", policies: "Policies", specials: "Specials", misc: "Everything else" };
const SECTION_ORDER = ["fees", "policies", "specials", "misc", "core"];
const SITE_LABEL = { zillow: "Zillow", apartments_com: "Apartments.com", own_site: "Own site", company_site: "Company site" };
const KIND_LABEL = {
  site_data: "Listing data on Proximity", page: "Web page", document: "Document", landlord_statement: "Landlord told their agent",
  landlord_answer: "Landlord's answer", pms: "Property management system", admin: "Proximity team", chat_backfill: "Old landlord chat",
  description: "Listing description", landlord_edit: "Landlord's edit",
};
const STATUS_TONE = { confirmed: "text-green-700", needs_review: "text-amber-700", rejected: "text-gray-400" };

const when = (iso) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "never");

async function getJson(url) {
  const r = await fetch(url);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d?.error || "Could not load");
  return d;
}

function sourceText(source, sourceRef) {
  if (!source) return sourceRef ? `From ${sourceRef}` : "No source recorded";
  const base = source.foundSite ? `${SITE_LABEL[source.foundSite]} (found)` : KIND_LABEL[source.kind] ?? source.kind;
  return source.url ? `${base}: ${source.url}` : source.label ? `${base}: ${source.label}` : base;
}

function Fact({ f }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="px-3 py-2 text-sm">
      <button type="button" onClick={() => setOpen((v) => !v)} className="w-full text-left">
        <div className="flex items-start justify-between gap-3">
          <span className="text-gray-900">{f.summary}</span>
          <span className="shrink-0 text-[11px] text-gray-500">{f.landlordSet ? <span className="mr-1 rounded-full bg-green-100 px-2 py-0.5 font-semibold text-green-800">landlord</span> : null}{f.confidence}</span>
        </div>
        <div className="mt-0.5 truncate text-[11px] text-gray-500">{f.key} · {f.scope} · {sourceText(f.source, f.sourceRef)}</div>
      </button>
      {open && (
        <div className="mt-2 space-y-1 rounded-lg bg-gray-50 p-2 text-[11px] text-gray-600">
          {f.excerpt && <div><span className="font-semibold">Source text:</span> &ldquo;{f.excerpt}&rdquo;</div>}
          {f.source?.url && <div><a href={f.source.url} target="_blank" rel="noopener noreferrer" className="break-all text-blue-700 underline">{f.source.url}</a></div>}
          <div>Seen {when(f.observedAt)}{f.validFrom ? ` · from ${f.validFrom}` : ""}{f.validUntil ? ` · until ${f.validUntil}` : ""}</div>
          {f.value && Object.keys(f.value).length > 0 && <pre className="whitespace-pre-wrap break-all font-mono">{JSON.stringify(f.value, null, 1)}</pre>}
        </div>
      )}
    </div>
  );
}

function Detail({ listingId }) {
  const [d, setD] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    let live = true;
    setD(null); setError(null);
    getJson(`/api/admin/agents/knowledge?listingId=${listingId}`).then((x) => live && setD(x)).catch((e) => live && setError(e.message));
    return () => { live = false; };
  }, [listingId]);

  if (error) return <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  if (!d) return <div className="py-10 text-center text-sm text-gray-400">Loading knowledge...</div>;

  const bySection = SECTION_ORDER.map((s) => [s, d.facts.filter((f) => f.section === s)]).filter(([, list]) => list.length);
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold text-gray-900">{d.listing.name}</h3>
        <div className="text-xs text-gray-500">{d.listing.address}</div>
        <div className="mt-1 text-xs text-gray-600">{d.facts.length} facts · {d.sources.length} sources · {d.found.filter((f) => f.status === "confirmed").length} confirmed found pages</div>
      </div>

      <section>
        <h4 className="mb-2 text-sm font-semibold text-gray-900">Facts</h4>
        {bySection.length === 0 ? <p className="text-sm text-gray-500">This listing&apos;s agent knows nothing yet.</p> : bySection.map(([s, list]) => (
          <div key={s} className="mb-3">
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">{SECTION_LABEL[s]} ({list.length})</div>
            <div className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">{list.map((f) => <Fact key={f.id} f={f} />)}</div>
          </div>
        ))}
      </section>

      <section>
        <h4 className="mb-2 text-sm font-semibold text-gray-900">Sources</h4>
        {d.sources.length === 0 ? <p className="text-sm text-gray-500">None.</p> : (
          <div className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
            {d.sources.map((s) => (
              <div key={s.id} className="px-3 py-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-gray-900">{s.foundSite ? `${SITE_LABEL[s.foundSite]} (found)` : KIND_LABEL[s.kind] ?? s.kind}</span>
                  <span className="shrink-0 text-gray-500">{s.facts} facts</span>
                </div>
                {s.url ? <a href={s.url} target="_blank" rel="noopener noreferrer" className="block truncate text-blue-700 underline">{s.url}</a> : s.label ? <div className="truncate text-gray-600">{s.label}</div> : null}
                {(s.lastCheckedAt || s.lastStatus) && (
                  <div className="text-gray-500">Checked {when(s.lastCheckedAt)}{s.lastStatus ? ` · ${s.lastStatus.replace(/_/g, " ")}` : ""}{s.failures ? ` · ${s.failures} failures` : ""}{s.lastError ? ` · ${s.lastError}` : ""}{s.enabled === false ? " · disabled" : ""}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h4 className="mb-2 text-sm font-semibold text-gray-900">Found by source search</h4>
        {d.found.length === 0 ? <p className="text-sm text-gray-500">Nothing found yet.</p> : (
          <div className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
            {d.found.map((f) => (
              <div key={f.id} className="px-3 py-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-gray-900">{SITE_LABEL[f.site] ?? f.site} {f.pageType}</span>
                  <span className={`shrink-0 ${STATUS_TONE[f.status] ?? ""}`}>{f.status.replace(/_/g, " ")}</span>
                </div>
                <a href={f.url} target="_blank" rel="noopener noreferrer" className="block truncate text-blue-700 underline">{f.title || f.url}</a>
                {f.evidence && <div className="text-gray-500">{f.evidence}</div>}
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h4 className="mb-2 text-sm font-semibold text-gray-900">Recent changes</h4>
        {d.events.length === 0 ? <p className="text-sm text-gray-500">None.</p> : (
          <div className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
            {d.events.map((e) => (
              <div key={e.id} className="flex items-start justify-between gap-3 px-3 py-1.5 text-xs">
                <span className="text-gray-800">{e.summary ?? e.key}</span>
                <span className="shrink-0 text-gray-500">{e.cause.replace(/_/g, " ")} · {e.status} · {when(e.createdAt)}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

export default function AgentsKnowledgeView({ search = "" }) {
  const [listings, setListings] = useState(null);
  const [error, setError] = useState(null);
  const [picked, setPicked] = useState(null);
  const [own, setOwn] = useState("");

  const load = useCallback(async () => {
    try {
      const d = await getJson("/api/admin/agents/knowledge");
      setListings(d.listings);
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const q = `${search} ${own}`.trim().toLowerCase();
  const shown = useMemo(() => (listings ?? []).filter((l) => !q || `${l.name} ${l.address}`.toLowerCase().includes(q)), [listings, q]);

  if (error) return <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  if (!listings) return <div className="py-20 text-center text-sm text-gray-400">Loading listings...</div>;

  const withFacts = listings.filter((l) => l.facts > 0).length;
  return (
    <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
      <div>
        <input value={own} onChange={(e) => setOwn(e.target.value)} placeholder="Find a listing" className="mb-2 w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm" />
        <div className="mb-2 text-xs text-gray-500">{withFacts} of {listings.length} listings know something</div>
        <div className="max-h-[70vh] divide-y divide-gray-100 overflow-y-auto rounded-xl border border-gray-200 bg-white">
          {shown.map((l) => (
            <button key={l.listingId} type="button" onClick={() => setPicked(l.listingId)} className={`block w-full px-3 py-2 text-left text-sm ${picked === l.listingId ? "bg-gray-100" : "hover:bg-gray-50"}`}>
              <div className="truncate text-gray-900">{l.name}</div>
              <div className="text-[11px] text-gray-500">{l.facts} facts · {l.sources} sources · {l.foundConfirmed} found{l.foundToReview ? ` (+${l.foundToReview} to review)` : ""} · {l.status}</div>
            </button>
          ))}
          {shown.length === 0 && <div className="px-3 py-4 text-sm text-gray-500">No listings match.</div>}
        </div>
      </div>
      <div>{picked ? <Detail listingId={picked} /> : <p className="py-10 text-center text-sm text-gray-500">Pick a listing to see what its agent knows.</p>}</div>
    </div>
  );
}
