/*
 * GET /api/admin/analytics?tab=<slug>&weeks=<4|12|26|52>[&link=<id>][&funnel=<source:x|campaign:x>]
 *
 * One tab of the admin Analytics page (PRD 7.6). Only the open tab is
 * computed. The page is pinned: it ignores the dashboard's dev/prod switch
 * (no x-db-target is read here) and always reads this site's own database,
 * plus production Google Analytics.
 *
 * Response: { tabs: [{ slug, title }], tab, weeks, weekOptions, keys,
 *             sourceLine, blocks | null, controls | null }
 * blocks is null when the tab failed to load; the page says so.
 *
 * @auth admin, super
 */
import { NextResponse } from "next/server";
import { requireDbRole } from "@/lib/userRole";
import { isProdData } from "@/lib/appEnv";
import { TABS } from "@/lib/analytics/tabs";
import { WEEK_OPTIONS, buildPeriod, parseWeeks } from "@/lib/analytics/periods";
import { dataSourceLine, snapshotTakenAt } from "@/lib/analytics/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req) {
  const session = await requireDbRole(["admin", "super"]);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const params = new URL(req.url).searchParams;
  const tab = TABS.find((t) => t.slug === params.get("tab")) ?? TABS[0];
  const weeks = parseWeeks(params.get("weeks"));
  const period = buildPeriod(weeks);
  const link = params.get("link");
  const options = {
    link: UUID.test(link ?? "") ? link : null,
    funnel: (params.get("funnel") ?? "").slice(0, 100) || null,
  };

  const [snapshotAt, result] = await Promise.all([
    isProdData() ? null : snapshotTakenAt().catch(() => null),
    tab.load(period, options).catch((err) => {
      console.error(`[analytics] tab ${tab.slug} failed:`, err?.message);
      return null;
    }),
  ]);

  return NextResponse.json({
    tabs: TABS.map(({ slug, title }) => ({ slug, title })),
    tab: tab.slug,
    weeks,
    weekOptions: WEEK_OPTIONS,
    keys: period.keys,
    sourceLine: dataSourceLine(snapshotAt),
    blocks: result?.blocks ?? null,
    controls: result?.controls ?? null,
  });
}
