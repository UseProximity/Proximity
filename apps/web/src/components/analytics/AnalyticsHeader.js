import Link from "next/link";
import { WEEK_OPTIONS } from "@/lib/analytics/periods";

/* Title, data-source line, tab bar and period picker for every /analytics tab. */

export default function AnalyticsHeader({ tabs, activeSlug, weeks, sourceLine }) {
  return (
    <header className="space-y-4">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold text-gray-900">Analytics</h1>
        <p className="text-sm text-gray-600">
          Totals and weekly trends for the last {weeks} weeks (weeks start Monday; the latest week
          is still in progress). Changes compare against the {weeks} weeks before. {sourceLine}{" "}
          Google Analytics numbers always describe the live site.
        </p>
      </div>

      {tabs.length > 1 && (
        <nav className="flex flex-wrap gap-1 border-b border-gray-200" aria-label="Analytics tabs">
          {tabs.map((t) => (
            <Link
              key={t.slug}
              href={`/analytics/${t.slug}?weeks=${weeks}`}
              aria-current={t.slug === activeSlug ? "page" : undefined}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
                t.slug === activeSlug
                  ? "border-red-600 text-red-700"
                  : "border-transparent text-gray-600 hover:border-gray-300 hover:text-gray-900"
              }`}
            >
              {t.title}
            </Link>
          ))}
        </nav>
      )}

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-gray-600">Period:</span>
        {WEEK_OPTIONS.map((w) => (
          <Link
            key={w}
            href={`/analytics/${activeSlug}?weeks=${w}`}
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
    </header>
  );
}
