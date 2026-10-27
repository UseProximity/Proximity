"use client";

/*
 * Two pickers for tour times, both in St. Louis time.
 *
 *   WeeklyGrid   the student's standing pattern: weekday columns, hour rows
 *                (8am to 8pm), tap to toggle a block. Saved on the account.
 *   DatePicker   real dates: the next 14 days as rows of hour chips. Used
 *                by the landlord to propose times, and for a one-off edit of
 *                the real-date slots a pattern produced.
 */
import { DAYS, DAY_LABELS, HOURS, hourLabel, upcomingDays, chicagoToUtc } from "@/lib/agents/tourTime";

export function WeeklyGrid({ pattern, onChange }) {
  const has = (day, h) => (pattern?.[day] ?? []).includes(h);
  const toggle = (day, h) => {
    const cur = new Set(pattern?.[day] ?? []);
    if (cur.has(h)) cur.delete(h); else cur.add(h);
    onChange({ ...pattern, [day]: [...cur].sort((a, b) => a - b) });
  };
  const order = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  return (
    <div className="overflow-x-auto">
      <table className="w-full table-fixed border-separate border-spacing-0.5 text-[11px]">
        <thead>
          <tr>
            <th className="w-14" />
            {order.map((d) => <th key={d} className="py-1 font-semibold text-gray-600">{DAY_LABELS[d]}</th>)}
          </tr>
        </thead>
        <tbody>
          {HOURS.map((h) => (
            <tr key={h}>
              <td className="pr-1 text-right text-gray-500">{hourLabel(h)}</td>
              {order.map((d) => (
                <td key={d}>
                  <button
                    type="button"
                    aria-pressed={has(d, h)}
                    onClick={() => toggle(d, h)}
                    className={`h-6 w-full rounded ${has(d, h) ? "bg-red-500" : "bg-gray-100 hover:bg-gray-200"}`}
                    title={`${DAY_LABELS[d]} ${hourLabel(h)}`}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1 text-[11px] text-gray-500">Tap the hours you can usually tour. Times are St. Louis time.</p>
    </div>
  );
}

/* Real dates, next 14 days. `selected` is a Set of ISO strings. */
export function DatePicker({ selected, onToggle, days = 14 }) {
  const list = upcomingDays({ days });
  return (
    <div className="space-y-1">
      {list.map((day) => (
        <div key={day.key} className="flex items-center gap-2">
          <div className="w-24 shrink-0 text-xs text-gray-600">{day.label}</div>
          <div className="flex flex-wrap gap-1">
            {HOURS.map((h) => {
              const iso = chicagoToUtc(day.y, day.m, day.d, h).toISOString();
              const on = selected.has(iso);
              return (
                <button key={h} type="button" aria-pressed={on} onClick={() => onToggle(iso)}
                  className={`rounded px-1.5 py-0.5 text-[11px] ${on ? "bg-red-500 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
                  {hourLabel(h)}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

export { DAYS };
