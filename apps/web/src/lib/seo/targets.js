import { washuPages } from "@/lib/washuPages";
import { guides } from "@/lib/guides";

/*
 * The evidence-backed target-query map the measurement engine tracks.
 *
 * Sources (Aug 2026 research sprint): Search Console 3-month export (rank +
 * impression data), Google Autocomplete harvest, SERP gap analysis, r/washu
 * language mining. Core-page targets live here; /washu page targets come from
 * each registry entry's targetQueries so page and tracking stay in sync.
 * Extend with Keyword Planner volume data when available; keep entries out of
 * this list unless there is demand evidence (no guessed keywords).
 */

export const CORE_TARGETS = [
  // Head cluster: Proximity already ranks 10-30 with real impressions (GSC).
  { query: "washu off campus housing", page: "/", evidence: "gsc: 202 impressions, pos 14.5" },
  { query: "wustl off campus housing", page: "/", evidence: "gsc: 383 impressions, pos 24.4" },
  { query: "wash u off campus housing", page: "/", evidence: "gsc: 315 impressions, pos 17.4" },
  { query: "off campus housing washu", page: "/", evidence: "gsc: 13 impressions, pos 10.2" },
  { query: "washu housing", page: "/", evidence: "gsc: 47 impressions, pos 12.1" },
  { query: "washu student housing", page: "/", evidence: "gsc: 62 impressions, pos 16.3" },
  { query: "washu apartments", page: "/", evidence: "gsc: 35 impressions, pos 19.1" },
  { query: "wustl apartments", page: "/", evidence: "gsc: 122 impressions, pos 30.1" },
  { query: "apartments near washu", page: "/browse", evidence: "gsc: 99 impressions, pos 38.2" },
  { query: "student apartments near washington university st louis", page: "/browse", evidence: "gsc: 64 impressions, pos 41.4" },
];

/** Flat list of { query, page } the engine tracks each week. */
export function allTargets() {
  return [
    ...CORE_TARGETS.map(({ query, page }) => ({ query, page })),
    ...washuPages.flatMap((p) =>
      (p.targetQueries ?? []).map((query) => ({
        query,
        page: `/washu/${p.slug}`,
      }))
    ),
    ...guides.map((g) => ({
      query: g.title.toLowerCase(),
      page: `/guides/${g.slug}`,
    })),
  ];
}

/** Pages whose freshness the engine watches (dateModified staleness). */
export function trackedPages() {
  return [
    ...washuPages.map((p) => ({
      page: `/washu/${p.slug}`,
      dateModified: p.dateModified,
    })),
    ...guides
      .filter((g) => g.dateModified)
      .map((g) => ({
        page: `/guides/${g.slug}`,
        dateModified: g.dateModified,
      })),
  ];
}
