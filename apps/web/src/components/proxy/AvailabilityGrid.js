"use client";

/*
 * The tour time grid: the next seven real dates across, the hours 8am to
 * 7pm down, cells touching, click or drag to paint a selection (Wyatt,
 * 2026-10-27). Each hour label sits at the top edge of its row: the time
 * is when the block starts. Used by the student to say when they can tour
 * and by the landlord to propose other times.
 *
 * `selected` is a Set of ISO strings (one-hour slots); onChange gets the
 * next Set.
 */
import { useCallback, useEffect, useRef } from "react";
import { HOURS, HOUR_MAX, hourLabel, upcomingDays, chicagoToUtc, TZ } from "@/lib/agents/tourTime";

/* "CDT" or "CST", whichever St. Louis is on right now. */
export function zoneAbbrev(date = new Date()) {
  const part = new Intl.DateTimeFormat("en-US", { timeZone: TZ, timeZoneName: "short" }).formatToParts(date).find((p) => p.type === "timeZoneName");
  return part?.value ?? "CT";
}

export function DateGrid({ selected, onChange, days = 7 }) {
  const list = upcomingDays({ days });
  const cells = list.map((day) => HOURS.map((h) => ({ iso: chicagoToUtc(day.y, day.m, day.d, h).toISOString(), h })));
  // The latest selection, so a fast drag never paints from a stale render.
  const latest = useRef(selected);
  useEffect(() => { latest.current = selected; }, [selected]);
  const drag = useRef(null); // { mode: true to select, false to clear }

  const paint = useCallback((iso) => {
    if (!drag.current) return;
    const cur = latest.current;
    if (drag.current.mode ? cur.has(iso) : !cur.has(iso)) return;
    const next = new Set(cur);
    if (drag.current.mode) next.add(iso); else next.delete(iso);
    latest.current = next;
    onChange(next);
  }, [onChange]);

  useEffect(() => {
    const end = () => { drag.current = null; };
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    return () => { window.removeEventListener("pointerup", end); window.removeEventListener("pointercancel", end); };
  }, []);

  const onPointerDown = (iso) => (e) => {
    e.preventDefault();
    drag.current = { mode: !latest.current.has(iso) };
    paint(iso);
  };
  // Touch drags do not fire pointerenter on the cells under the finger, so
  // the cell is looked up from the pointer position instead.
  const onPointerMove = (e) => {
    if (!drag.current) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const iso = el?.getAttribute?.("data-iso");
    if (iso) paint(iso);
  };

  return (
    <div className="select-none overflow-x-auto" onPointerMove={onPointerMove} style={{ touchAction: "none" }}>
      <table className="w-full table-fixed border-collapse text-[11px]">
        <thead>
          <tr>
            <th className="w-12" />
            {list.map((d) => (
              <th key={d.key} className="pb-1 text-center font-semibold text-gray-700">
                <div>{d.label.split(" ")[0]}</div>
                <div className="font-normal text-gray-500">{d.label.split(" ").slice(1).join(" ")}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {HOURS.map((h, r) => (
            <tr key={h}>
              <td className="relative w-12 pr-1 text-right align-top text-gray-500">
                <span className="relative -top-1.5 block leading-none">{hourLabel(h)}</span>
              </td>
              {cells.map((col, c) => {
                const cell = col[r];
                const on = selected.has(cell.iso);
                return (
                  <td key={cell.iso} className="p-0">
                    <div
                      role="checkbox"
                      aria-checked={on}
                      aria-label={`${list[c].label} ${hourLabel(h)}`}
                      data-iso={cell.iso}
                      onPointerDown={onPointerDown(cell.iso)}
                      onPointerEnter={() => paint(cell.iso)}
                      className={`h-6 w-full cursor-pointer border border-gray-200 ${on ? "bg-red-500" : "bg-white hover:bg-red-50"}`}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
          {/* The end of the last block, so the grid reads as 8am to 8pm. */}
          <tr>
            <td className="relative w-12 pr-1 text-right align-top text-gray-500">
              <span className="relative -top-1.5 block leading-none">{hourLabel(HOUR_MAX + 1)}</span>
            </td>
            {list.map((d) => <td key={d.key} className="h-2 p-0" />)}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
