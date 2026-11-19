"use client";

/*
 * The admin Analytics page (/dashboard/admin/analytics, PRD 7.6): every tab the
 * old /analytics page had, plus Marketing. The open tab, the period and the
 * Marketing filters (link, funnel) live in the query string, so a reload or a
 * shared link opens the same view. Only the open tab is computed
 * (GET /api/admin/analytics).
 *
 * Pinned: it always reads this site's own database, whatever the dashboard's
 * dev/prod switch says (the shell shows the notice), so no x-db-target is sent.
 */
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import AnalyticsHeader from "@/components/analytics/AnalyticsHeader";
import AnalyticsBlock from "@/components/analytics/AnalyticsBlock";

const BASE = "/dashboard/admin/analytics";

function hrefWith(params, changes) {
  const next = new URLSearchParams(params.toString());
  for (const [k, v] of Object.entries(changes)) {
    if (v === null || v === undefined || v === "") next.delete(k);
    else next.set(k, String(v));
  }
  const qs = next.toString();
  return qs ? `${BASE}?${qs}` : BASE;
}

function AnalyticsViewInner() {
  const params = useSearchParams();
  const router = useRouter();
  const query = params.toString();
  const [state, setState] = useState({ loading: true, data: null, error: null, query: null });

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    fetch(`/api/admin/analytics${query ? `?${query}` : ""}`)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || "Could not load analytics.");
        return body;
      })
      .then((data) => !cancelled && setState({ loading: false, data, error: null, query }))
      .catch((err) => !cancelled && setState({ loading: false, data: null, error: err.message, query }));
    return () => {
      cancelled = true;
    };
  }, [query]);

  const { data, loading, error } = state;
  // A tab switch keeps the period only; the Marketing filters belong to that tab.
  const hrefFor = (slug, weeks) =>
    slug === data?.tab ? hrefWith(params, { tab: slug, weeks }) : hrefWith(new URLSearchParams(), { tab: slug, weeks });

  if (!data) {
    return error ? (
      <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</p>
    ) : (
      <div className="py-20 text-center text-sm text-gray-400">Loading analytics…</div>
    );
  }

  const funnel = data.controls?.funnel;
  const link = data.controls?.link;
  return (
    <div className="space-y-10">
      <AnalyticsHeader
        tabs={data.tabs}
        activeSlug={data.tab}
        weeks={data.weeks}
        weekOptions={data.weekOptions}
        sourceLine={data.sourceLine}
        hrefFor={hrefFor}
      />

      {(link || funnel) && (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          {link && (
            <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-amber-900">
              Showing campaign link <strong>{link.slug}</strong> only ({link.name}).{" "}
              <Link href={hrefWith(params, { link: null })} className="underline">
                Show all
              </Link>
            </span>
          )}
          {funnel && (
            <label className="flex items-center gap-2 text-gray-700">
              Funnel for
              <select
                value={funnel.value}
                onChange={(e) => router.push(hrefWith(params, { funnel: e.target.value }), { scroll: false })}
                className="rounded-md border border-gray-300 px-2 py-1 text-sm"
              >
                <option value="">All sources</option>
                {funnel.value && !funnel.options.some((o) => o.value === funnel.value) && (
                  <option value={funnel.value}>{funnel.value}</option>
                )}
                {funnel.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}

      <div className={loading ? "opacity-50 transition-opacity" : undefined} aria-busy={loading}>
        {error && <p className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</p>}
        {data.blocks ? (
          <div className="space-y-10">
            {data.blocks.map((b) => (
              <AnalyticsBlock key={b.title} block={b} weekKeys={data.keys} />
            ))}
          </div>
        ) : (
          <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            This tab could not be loaded right now. Try again in a minute.
          </p>
        )}
      </div>
    </div>
  );
}

export default function AnalyticsView() {
  return (
    <Suspense fallback={<div className="py-20 text-center text-sm text-gray-400">Loading analytics…</div>}>
      <AnalyticsViewInner />
    </Suspense>
  );
}
