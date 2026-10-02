import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { appEnv, isProdData } from "@/lib/appEnv";
import { getAnalyticsViewer } from "@/lib/analytics/access";
import { SECTION_LOADERS } from "@/lib/analytics/sections";
import { buildPeriod, parseWeeks, WEEK_OPTIONS } from "@/lib/analytics/periods";
import { snapshotTakenAt } from "@/lib/analytics/db";
import AnalyticsSection from "@/components/analytics/AnalyticsSection";

/*
 * /analytics: read-only metrics for the team, and for partners on the sandbox.
 * Access rules and which sections a partner sees live in @/lib/analytics/access.
 */

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Analytics | Proximity",
  robots: { index: false, follow: false },
};

function dataSourceLine(snapshotAt) {
  if (isProdData()) return "Database numbers are live from the production site.";
  const when = snapshotAt
    ? new Date(snapshotAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
    : "the last weekly refresh";
  return `Database numbers come from this ${appEnv()} copy of production, refreshed weekly (last on ${when}), plus any activity on this site since.`;
}

export default async function AnalyticsPage({ searchParams }) {
  const session = await auth();
  if (!session?.user?.id) redirect(`/login?callbackUrl=${encodeURIComponent("/analytics")}`);

  const viewer = await getAnalyticsViewer(session);
  if (!viewer) notFound();

  const weeks = parseWeeks((await searchParams)?.weeks);
  const period = buildPeriod(weeks);

  const [snapshotAt, ...results] = await Promise.all([
    isProdData() ? null : snapshotTakenAt(),
    ...viewer.sections.map(async (s) => {
      try {
        return { ...s, model: await SECTION_LOADERS[s.key](period) };
      } catch (err) {
        console.error(`[analytics] section ${s.key} failed:`, err?.message);
        return { ...s, error: true };
      }
    }),
  ]);

  return (
    <main className="mx-auto max-w-6xl space-y-10 px-4 py-8 sm:px-6">
      <header className="space-y-3">
        <h1 className="text-2xl font-bold text-gray-900">Analytics</h1>
        <p className="text-sm text-gray-600">
          Totals and weekly trends for the last {weeks} weeks (weeks start Monday; the latest
          week is still in progress). Changes compare against the {weeks} weeks before.{" "}
          {dataSourceLine(snapshotAt)} Google Analytics numbers always describe the live site.
        </p>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-gray-600">Period:</span>
          {WEEK_OPTIONS.map((w) => (
            <Link
              key={w}
              href={`/analytics?weeks=${w}`}
              className={`rounded-md border px-3 py-1 ${
                w === weeks
                  ? "border-gray-900 bg-gray-900 text-white"
                  : "border-gray-300 text-gray-700 hover:bg-gray-50"
              }`}
            >
              {w} weeks
            </Link>
          ))}
        </div>
        {results.length > 1 && (
          <nav className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {results.map((s) => (
              <a key={s.key} href={`#${s.key}`} className="text-red-700 hover:underline">
                {s.title}
              </a>
            ))}
          </nav>
        )}
      </header>

      {results.map((s) => (
        <AnalyticsSection
          key={s.key}
          id={s.key}
          title={s.title}
          model={s.model}
          error={s.error}
          weekKeys={period.keys}
        />
      ))}
    </main>
  );
}
