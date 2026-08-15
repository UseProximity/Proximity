import { allTargets, trackedPages } from "@/lib/seo/targets";

/*
 * Turns two GSC windows into the weekly flag list. Pure functions only —
 * the cron route owns all I/O (fetch, DB writes, issue creation).
 *
 * Flag types:
 *   position_drop   target query slipped >3 positions period over period
 *   impressions_drop target query impressions fell >30% period over period
 *   low_ctr         page has >100 impressions and CTR <1% (title/meta candidates)
 *   zero_impressions tracked page collected no impressions this window
 *   stale           tracked page not modified in >90 days AND declining
 */

const norm = (s) => (s ?? "").trim().toLowerCase();

function sumByQuery(rows) {
  const map = new Map();
  for (const r of rows) {
    const key = norm(r.query);
    const cur = map.get(key) ?? { impressions: 0, clicks: 0, posNum: 0, posDen: 0 };
    cur.impressions += r.impressions;
    cur.clicks += r.clicks;
    cur.posNum += r.position * r.impressions;
    cur.posDen += r.impressions;
    map.set(key, cur);
  }
  for (const v of map.values()) {
    v.position = v.posDen ? v.posNum / v.posDen : null;
  }
  return map;
}

function sumByPage(rows) {
  const map = new Map();
  for (const r of rows) {
    let path;
    try {
      path = new URL(r.page).pathname;
    } catch {
      path = r.page;
    }
    const cur = map.get(path) ?? { impressions: 0, clicks: 0 };
    cur.impressions += r.impressions;
    cur.clicks += r.clicks;
    map.set(path, cur);
  }
  return map;
}

export function computeFlags({ current, previous }, now = new Date()) {
  const flags = [];
  const curQ = sumByQuery(current);
  const prevQ = sumByQuery(previous);
  const curP = sumByPage(current);

  for (const { query, page } of allTargets()) {
    const cur = curQ.get(norm(query));
    const prev = prevQ.get(norm(query));
    if (!cur && !prev) continue;

    if (cur?.position != null && prev?.position != null && cur.position - prev.position > 3) {
      flags.push({
        type: "position_drop",
        query,
        page,
        detail: `position ${prev.position.toFixed(1)} -> ${cur.position.toFixed(1)}`,
        recommendation: "Re-check the SERP for this query and refresh the page's direct answer and FAQs.",
      });
    }
    if (prev?.impressions >= 20 && cur && cur.impressions < prev.impressions * 0.7) {
      flags.push({
        type: "impressions_drop",
        query,
        page,
        detail: `impressions ${prev.impressions} -> ${cur.impressions}`,
        recommendation: "Demand shifted or rankings slipped below visibility; compare the SERP and consider a refresh.",
      });
    }
  }

  for (const [path, stats] of curP) {
    if (stats.impressions > 100 && stats.clicks / stats.impressions < 0.01) {
      flags.push({
        type: "low_ctr",
        page: path,
        detail: `${stats.impressions} impressions, CTR ${((stats.clicks / stats.impressions) * 100).toFixed(2)}%`,
        recommendation: "Title/meta rewrite candidate: the page is seen but not chosen.",
      });
    }
  }

  const DAY_MS = 24 * 60 * 60 * 1000;
  for (const { page, dateModified } of trackedPages()) {
    const stats = curP.get(page);
    const ageDays = (now - new Date(dateModified)) / DAY_MS;
    if (!stats || stats.impressions === 0) {
      flags.push({
        type: "zero_impressions",
        page,
        detail: "no impressions in the last 28 days",
        recommendation: "Check indexation in Search Console (URL inspection) and internal links.",
      });
    } else if (ageDays > 90) {
      flags.push({
        type: "stale",
        page,
        detail: `content last modified ${Math.round(ageDays)} days ago`,
        recommendation: "Refresh copy and bump dateModified; stale pages drift down.",
      });
    }
  }

  return flags;
}

export function flagsToMarkdown(flags, ranges) {
  if (!flags.length) return null;
  const lines = [
    `Windows compared: ${ranges.previousRange.start}..${ranges.previousRange.end} vs ${ranges.currentRange.start}..${ranges.currentRange.end}`,
    "",
    "| Type | Query | Page | Detail | Recommended action |",
    "|---|---|---|---|---|",
    ...flags.map(
      (f) =>
        `| ${f.type} | ${f.query ?? ""} | ${f.page} | ${f.detail} | ${f.recommendation} |`
    ),
  ];
  return lines.join("\n");
}
