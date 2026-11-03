"use client";

/*
 * Admin, Agents: getting every listing ready for launch (Wyatt, 2026-10-31).
 *
 *   Knowledge transfer   the report (read-only, so it is the dry run), then
 *                        seed every listing and read old landlord chats, in
 *                        batches until nothing remains
 *   Sources of truth     search every listing for its Zillow, Apartments.com
 *                        and own-site pages; exact address matches are saved
 *                        as confirmed, likely ones wait here for Accept or
 *                        Reject.
 *   Read found pages     the confirmed pages are read into each listing's
 *                        knowledge, own site over Apartments.com over Zillow,
 *                        never over what the landlord said (foundRead.js)
 *
 * Runs are loops of batch calls (a server call has 300 seconds), shown as
 * progress, stoppable between batches, and safe to start again: finished work
 * is skipped. A batch that makes no progress ends the loop.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";

const SITE_LABEL = { zillow: "Zillow", apartments_com: "Apartments.com", own_site: "Own site", company_site: "Company site" };

async function post(body) {
  const r = await fetch("/api/admin/agents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d?.error || "Request failed");
  return d.result;
}

function Tile({ label, value, note }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-lg font-semibold text-gray-900">{value}</div>
      {note && <div className="text-[11px] text-gray-500">{note}</div>}
    </div>
  );
}

export default function AgentsLaunchPanel({ onChanged }) {
  const [report, setReport] = useState(null);
  const [found, setFound] = useState(null);
  const [run, setRun] = useState(null); // { kind, text }
  const [preview, setPreview] = useState(null);
  const [showFlagged, setShowFlagged] = useState(false);
  const stopRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const [r, f] = await Promise.all([post({ action: "transferReport" }), post({ action: "foundSources" })]);
      setReport(r);
      setFound(f);
    } catch (err) {
      toast.error(err.message);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  /*
   * Repeat a batch action until it reports nothing remaining, the team stops
   * it, or a batch moves nothing (a listing that keeps failing must not spin
   * forever).
   */
  const loop = async (kind, body, describe, progressOf) => {
    stopRef.current = false;
    setRun({ kind, text: "Starting..." });
    const totals = { batches: 0, failed: 0 };
    try {
      for (;;) {
        const r = await post(body);
        totals.batches++;
        totals.failed += (r.failed?.length ?? 0) + (r.results?.filter((x) => x.error).length ?? 0);
        setRun({ kind, text: describe(r, totals) });
        if (!r.remaining || stopRef.current || progressOf(r) === 0) break;
      }
      toast.success(stopRef.current ? "Stopped" : "Done");
    } catch (err) {
      toast.error(err.message);
    } finally {
      setRun((cur) => (cur ? { ...cur, finished: true } : cur));
      await load();
      onChanged?.();
    }
  };

  // A full pass: every listing not seeded since the click, so listings seeded
  // before descriptions were read get them read now.
  const seedAll = () => loop("seed", { action: "seedBatch", limit: 15, since: new Date().toISOString() },
    (r, t) => `Seeded ${r.listings} in batch ${t.batches}; ${r.remaining} left${t.failed ? `; ${t.failed} failed` : ""}`,
    (r) => r.listings + (r.failed?.length ?? 0));
  const backfill = () => loop("backfill", { action: "backfill", maxRead: 12 },
    (r, t) => `Read ${r.read} chats in batch ${t.batches}; ${r.remaining} left${t.failed ? `; ${t.failed} failed` : ""}`,
    (r) => r.read + r.failed.length);
  const discoverAll = () => loop("discover", { action: "discover", limit: 12 },
    (r, t) => `Searched ${r.done} listings in batch ${t.batches} (${r.searches} searches); ${r.remaining} of ${r.total} left${t.failed ? `; ${t.failed} failed` : ""}`,
    (r) => r.done);

  const readFound = () => loop("readFound", { action: "readFound", limit: 4 },
    (r, t) => `Read ${r.pages} pages for ${r.listings} listings in batch ${t.batches} (${r.written} facts written, ${r.kept} kept from a better source); ${r.remaining} of ${r.total} left${t.failed ? `; ${t.failed} failed` : ""}`,
    (r) => r.listings + (r.failed?.length ?? 0));

  const tryDiscover = async () => {
    setRun({ kind: "preview", text: "Searching 3 listings without saving..." });
    try {
      const r = await post({ action: "discover", limit: 3, dryRun: true, redo: true });
      setPreview(r.results);
      setRun(null);
    } catch (err) {
      toast.error(err.message);
      setRun(null);
    }
  };

  const review = async (id, accept) => {
    try {
      await post({ action: "reviewSource", id, accept });
      setFound((f) => ({ ...f, review: f.review.filter((x) => x.id !== id) }));
    } catch (err) {
      toast.error(err.message);
    }
  };

  if (!report || !found) return <div className="mb-8 text-sm text-gray-400">Loading launch status...</div>;
  const t = report.totals;
  const running = run && !run.finished;
  const flagged = report.rows.filter((r) => r.flags.length);

  return (
    <div className="mb-10 space-y-8">
      <section>
        <h3 className="mb-1 text-sm font-semibold text-gray-900">Launch: knowledge transfer</h3>
        <p className="mb-3 text-xs text-gray-500">
          Every published listing&apos;s agent is filled from what the site already stores, then from old landlord chats. Agents stay off for students until switched on below.
        </p>
        <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Tile label="Published listings" value={t.listings} />
          <Tile label="Seeded" value={t.seeded} note={[t.unseeded ? `${t.unseeded} to go` : null, t.estimatedSeedCostCents ? `a pass costs ~$${(t.estimatedSeedCostCents / 100).toFixed(2)}` : "descriptions all read"].filter(Boolean).join(", ")} />
          <Tile label="With facts" value={t.withFacts} note={`${t.facts} facts`} />
          <Tile label="No live lease" value={t.flagged.noLiveLease} note="students can't contact" />
          <Tile label="No one to ask" value={t.flagged.noContact} note="questions can't be routed" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button disabled={running} onClick={seedAll} className="rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">Seed every listing</button>
          <button disabled={running} onClick={backfill} className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium disabled:opacity-50">Read old landlord chats</button>
          <button onClick={() => setShowFlagged((v) => !v)} className="text-xs text-gray-600 underline underline-offset-2">
            {showFlagged ? "Hide" : "Show"} {flagged.length} listings that need a look
          </button>
        </div>
        {showFlagged && (
          <div className="mt-3 max-h-80 divide-y divide-gray-100 overflow-y-auto rounded-xl border border-gray-200 bg-white">
            {flagged.map((r) => (
              <div key={r.listingId} className="flex items-center justify-between gap-2 px-3 py-1.5 text-xs">
                <span className="text-gray-900">{r.name}</span>
                <span className="text-gray-500">{r.flags.join(" · ")} · {r.facts} facts</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h3 className="mb-1 text-sm font-semibold text-gray-900">Launch: sources of truth</h3>
        <p className="mb-3 text-xs text-gray-500">
          Each listing is searched for its Zillow and Apartments.com pages and its own or its company&apos;s website. Pages showing the exact address are confirmed; likely matches wait below. Confirmed pages can then be read into each listing&apos;s knowledge: its own site first, then Apartments.com, then Zillow, and never over what the landlord said.
        </p>
        <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Tile label="Listings searched" value={`${found.searched} / ${found.listings}`} note={`${found.listingsWithConfirmed} with a confirmed source`} />
          {Object.keys(SITE_LABEL).map((k) => (
            <Tile key={k} label={SITE_LABEL[k]} value={found.bySite?.[k]?.confirmed ?? 0} note={`${found.bySite?.[k]?.needs_review ?? 0} to review`} />
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button disabled={running} onClick={tryDiscover} className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium disabled:opacity-50">Try 3 listings (saves nothing)</button>
          <button disabled={running} onClick={discoverAll} className="rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
            {found.searched ? "Search the rest" : "Search every listing"}
          </button>
          <span className="text-[11px] text-gray-500">About 5 Firecrawl searches per listing, 2 credits each.</span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button disabled={running || !found.read?.pages} onClick={readFound} className="rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
            {found.read?.pagesRead ? "Read the rest of the found pages" : "Read found pages into knowledge"}
          </button>
          <span className="text-[11px] text-gray-500">
            {found.read?.pagesRead ?? 0} of {found.read?.pages ?? 0} confirmed pages read, {found.read?.listings ?? 0} listings. Up to 8 pages per listing, one AI read per site.
          </span>
        </div>
        {preview && (
          <div className="mt-3 space-y-2 rounded-xl border border-gray-200 bg-white p-3 text-xs">
            {preview.map((p) => (
              <div key={p.listingId}>
                <div className="font-semibold text-gray-900">{report.rows.find((r) => r.listingId === p.listingId)?.name ?? p.listingId} <span className="font-normal text-gray-500">· {p.searches} searches{p.error ? ` · ${p.error}` : ""}</span></div>
                {(p.pages ?? []).map((g) => (
                  <div key={g.url} className="ml-3 truncate text-gray-600">
                    <span className={g.status === "confirmed" ? "text-green-700" : "text-amber-700"}>{g.status === "confirmed" ? "confirmed" : "review"}</span> · {SITE_LABEL[g.site]} {g.pageType} · <a href={g.url} target="_blank" rel="noopener noreferrer" className="underline">{g.url}</a>
                  </div>
                ))}
                {!p.pages?.length && !p.error && <div className="ml-3 text-gray-500">Nothing found.</div>}
              </div>
            ))}
          </div>
        )}
      </section>

      {run && (
        <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700">
          {!run.finished && <span className="h-3 w-3 animate-spin rounded-full border-2 border-gray-300 border-t-gray-700" />}
          <span>{run.text}</span>
          {!run.finished && run.kind !== "preview" && (
            <button onClick={() => { stopRef.current = true; }} className="ml-auto rounded border border-gray-300 px-2 py-0.5">Stop after this batch</button>
          )}
          {run.finished && <button onClick={() => setRun(null)} className="ml-auto text-gray-500">Dismiss</button>}
        </div>
      )}

      <section>
        <h3 className="mb-2 text-sm font-semibold text-gray-900">
          Sources to review <span className="ml-1 text-xs font-normal text-gray-500">({found.review.length}{found.review.length === 100 ? "+" : ""})</span>
        </h3>
        {found.review.length === 0 ? (
          <p className="text-sm text-gray-500">Nothing to review.</p>
        ) : (
          <div className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
            {found.review.map((r) => (
              <div key={r.id} className="flex items-start justify-between gap-3 px-3 py-2 text-xs">
                <div className="min-w-0">
                  <div className="text-gray-900"><span className="font-semibold">{r.listing}</span> <span className="text-gray-500">· {r.address}</span></div>
                  <a href={r.url} target="_blank" rel="noopener noreferrer" className="block truncate text-blue-700 underline">{r.title || r.url}</a>
                  <div className="text-gray-500">{SITE_LABEL[r.site]} {r.pageType} · {r.evidence}</div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button onClick={() => review(r.id, true)} className="rounded-lg bg-gray-900 px-2 py-1 font-semibold text-white">Accept</button>
                  <button onClick={() => review(r.id, false)} className="rounded-lg border border-gray-300 px-2 py-1">Reject</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
