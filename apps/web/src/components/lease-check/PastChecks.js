"use client";

import { FileText } from "lucide-react";

function severityCounts(flags) {
  const counts = { red: 0, yellow: 0, green: 0 };
  for (const flag of flags || []) {
    if (counts[flag.severity] != null) counts[flag.severity] += 1;
  }
  return counts;
}

export default function PastChecks({ checks, onSelect }) {
  if (!checks || checks.length === 0) return null;

  return (
    <section className="mt-12">
      <h2 className="text-sm font-semibold uppercase tracking-[0.24em] text-gray-400">
        Past checks
      </h2>
      <div className="mt-3 space-y-2">
        {checks.map((check) => {
          const counts = severityCounts(check.flags);
          return (
            <button
              key={check.id}
              type="button"
              onClick={() => onSelect(check)}
              className="flex w-full items-center gap-3 rounded-xl border border-gray-200 bg-white p-4 text-left transition hover:border-red-400 hover:bg-red-50"
            >
              <FileText size={18} className="shrink-0 text-gray-400" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-gray-900">{check.fileName}</p>
                <p className="text-xs text-gray-500">
                  {new Date(check.createdAt).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </p>
              </div>
              <div className="flex shrink-0 gap-2 text-xs font-semibold">
                {counts.red > 0 && <span className="text-red-600">{counts.red} red</span>}
                {counts.yellow > 0 && <span className="text-amber-600">{counts.yellow} yellow</span>}
                {counts.green > 0 && <span className="text-emerald-600">{counts.green} green</span>}
                {counts.red + counts.yellow + counts.green === 0 && (
                  <span className="text-gray-400">no flags</span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
