"use client";

/*
 * Where an import's information came from, on the review page (Wyatt,
 * 2026-10-27, round 6). Two parts:
 *
 *   Units, prices and photos   the pages the read used for the displayed
 *                              fields (the read's trace)
 *   What Proxy learned          each fact from the whole-site read, with the
 *                              page it came from; fills in while that read
 *                              is still running after the import
 */
import { useCallback, useEffect, useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";

const short = (u) => String(u ?? "").replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");

export default function ImportSources({ job, listingId }) {
  const [data, setData] = useState(null);
  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/landlord/listings/${listingId}/agent`);
      if (r.ok) setData(await r.json());
    } catch {}
  }, [listingId]);
  useEffect(() => { load(); }, [load]);
  const running = !!data?.sync?.job;
  useEffect(() => {
    if (!running) return;
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [running, load]);

  const readPages = (job?.result?.trace?.pages ?? []).map((p) => p.url).filter(Boolean);
  const facts = data ? Object.values(data.sections ?? {}).flat().filter((f) => f.sourceUrl) : [];
  const byPage = new Map();
  for (const f of facts) {
    if (!byPage.has(f.sourceUrl)) byPage.set(f.sourceUrl, []);
    byPage.get(f.sourceUrl).push(f);
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm">
      <p className="font-semibold text-gray-900">Where this came from</p>
      {readPages.length > 0 && (
        <div className="mt-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Units, prices and photos</p>
          <ul className="mt-1 space-y-0.5">
            {readPages.map((u) => (
              <li key={u}><a href={u} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-red-600 hover:underline"><ExternalLink className="h-3 w-3" /> {short(u)}</a></li>
            ))}
          </ul>
        </div>
      )}
      <div className="mt-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">What Proxy learned for students{facts.length ? ` (${facts.length})` : ""}</p>
        {running && <p className="mt-1 inline-flex items-center gap-1.5 text-xs text-gray-600"><Loader2 className="h-3 w-3 animate-spin" /> Reading the rest of your site ({data.sync.job.step}). You can leave; it keeps going.</p>}
        {!running && facts.length === 0 && <p className="mt-1 text-xs text-gray-500">Nothing yet. It fills in once the whole-site read finishes.</p>}
        <div className="mt-1 space-y-2">
          {[...byPage.entries()].map(([url, list]) => (
            <div key={url}>
              <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-red-600 hover:underline"><ExternalLink className="h-3 w-3" /> {short(url)}</a>
              <ul className="ml-4 mt-0.5 list-disc space-y-0.5 text-xs text-gray-700">
                {list.map((f) => <li key={f.id}>{f.summary}</li>)}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
