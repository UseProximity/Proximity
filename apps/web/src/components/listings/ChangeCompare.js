"use client";

/*
 * One website change shown side by side (Wyatt, 2026-11-05): what Proximity
 * shows now next to what the landlord's website says, from
 * lib/sourceImport/describeChange.js. Used on the landlord's import tab, the
 * landlord's Agent tab and the admin review queue.
 *
 * view: { title, unit, note, rows: [{ label, current, proposed }] }
 */
export default function ChangeCompare({ view, compact = false }) {
  if (!view) return null;
  return (
    <div className="min-w-0">
      <p className={`${compact ? "text-sm" : "text-sm"} font-medium text-gray-900`}>
        {view.title}
        {view.unit && <span className="font-normal text-gray-500"> · {view.unit}</span>}
      </p>
      {view.rows?.length > 0 && (
        <div className="mt-1.5 overflow-hidden rounded-lg border border-gray-200">
          <div className="grid grid-cols-[minmax(84px,auto)_1fr_1fr] bg-gray-50 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
            <span className="px-2 py-1" />
            <span className="px-2 py-1">On Proximity now</span>
            <span className="px-2 py-1">From the website</span>
          </div>
          {view.rows.map((r, i) => (
            <div key={`${r.label}-${i}`} className="grid grid-cols-[minmax(84px,auto)_1fr_1fr] border-t border-gray-100 text-xs">
              <span className="px-2 py-1.5 font-medium text-gray-600">{r.label}</span>
              <span className="break-words px-2 py-1.5 text-gray-700">{r.current}</span>
              <span className={`break-words px-2 py-1.5 ${r.proposed !== r.current ? "font-medium text-gray-900" : "text-gray-500"}`}>{r.proposed}</span>
            </div>
          ))}
        </div>
      )}
      {view.note && <p className="mt-1 text-[11px] text-gray-500">{view.note}</p>}
    </div>
  );
}
