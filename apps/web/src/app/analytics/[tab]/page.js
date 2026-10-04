import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { appEnv, isProdData } from "@/lib/appEnv";
import { getAnalyticsViewer } from "@/lib/analytics/access";
import { buildPeriod, parseWeeks } from "@/lib/analytics/periods";
import { snapshotTakenAt } from "@/lib/analytics/db";
import AnalyticsHeader from "@/components/analytics/AnalyticsHeader";
import AnalyticsBlock from "@/components/analytics/AnalyticsBlock";

/*
 * /analytics/[tab]: one tab of the metrics dashboard. Only the open tab is computed. Who may
 * open which tab lives in @/lib/analytics/access; the tabs themselves in @/lib/analytics/tabs.
 */

export const dynamic = "force-dynamic";
export const metadata = { title: "Analytics | Proximity", robots: { index: false, follow: false } };

function dataSourceLine(snapshotAt) {
  if (isProdData()) return "Database numbers are live from the production site.";
  const when = snapshotAt
    ? new Date(snapshotAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
    : "the last weekly refresh";
  return `Database numbers come from this ${appEnv()} copy of production, refreshed weekly (last on ${when}), plus any activity on this site since.`;
}

export default async function AnalyticsTabPage({ params, searchParams }) {
  const { tab: slug } = await params;
  const session = await auth();
  if (!session?.user?.id) {
    redirect(`/login?callbackUrl=${encodeURIComponent(`/analytics/${slug}`)}`);
  }

  const viewer = await getAnalyticsViewer(session);
  const tab = viewer?.tabs.find((t) => t.slug === slug);
  if (!tab) notFound(); // unknown tab, or one this viewer may not see: same answer

  const weeks = parseWeeks((await searchParams)?.weeks);
  const period = buildPeriod(weeks);

  const [snapshotAt, result] = await Promise.all([
    isProdData() ? null : snapshotTakenAt(),
    tab.load(period).catch((err) => {
      console.error(`[analytics] tab ${slug} failed:`, err?.message);
      return null;
    }),
  ]);

  return (
    <main className="mx-auto max-w-6xl space-y-10 px-4 py-8 sm:px-6">
      <AnalyticsHeader
        tabs={viewer.tabs}
        activeSlug={slug}
        weeks={weeks}
        sourceLine={dataSourceLine(snapshotAt)}
      />
      {result ? (
        result.blocks.map((b) => <AnalyticsBlock key={b.title} block={b} weekKeys={period.keys} />)
      ) : (
        <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          This tab could not be loaded right now. Try again in a minute.
        </p>
      )}
    </main>
  );
}
