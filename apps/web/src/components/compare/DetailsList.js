"use client";

/*
 * Every comparison row, in one bordered table: a section heading row, then
 * label on the left and the two values beside it. A slim bar stays pinned
 * under the site header with both names and a chip per section.
 */

import { useEffect, useRef, useState } from "react";
import { Check, Minus } from "lucide-react";

// The site header is 83px tall on phones and 104px from md up.
const STICKY = "top-[83px] md:top-[104px]";
const SCROLL_MARGIN = "scroll-mt-[150px] md:scroll-mt-[160px]";

function Value({ row, index }) {
  const v = row.values[index];
  const text = row.display[index];
  const note = row.notes[index];
  const isWinner = row.winner === index;

  if (v == null) return <span className="text-sm text-gray-300">–</span>;
  if (row.type === "boolean") {
    return v ? (
      <span className="inline-flex items-center gap-1 text-sm font-medium text-gray-900">
        <Check className="h-4 w-4 text-emerald-600" strokeWidth={2.5} />
        Yes
      </span>
    ) : (
      <span className="inline-flex items-center gap-1 text-sm text-gray-400">
        <Minus className="h-4 w-4" />
        No
      </span>
    );
  }
  if (row.type === "link") {
    return (
      <a href={v} target="_blank" rel="noreferrer" className="text-sm font-medium text-red-600 underline underline-offset-2">
        {text}
      </a>
    );
  }
  if (row.type === "list") {
    const other = row.values[1 - index] ?? [];
    return (
      <span className="flex flex-wrap justify-center gap-1">
        {v.map((item) => (
          <span
            key={item}
            className={`rounded-md border px-1.5 py-0.5 text-xs ${
              other.includes(item) ? "border-gray-200 bg-gray-50 text-gray-700" : "border-emerald-200 bg-emerald-50 text-emerald-800"
            }`}
          >
            {item}
          </span>
        ))}
      </span>
    );
  }
  if (row.type === "quote") return <q className="line-clamp-4 text-sm leading-relaxed text-gray-600">{v}</q>;
  return (
    <span className="inline-flex flex-col items-center">
      <span className={`text-sm font-semibold tabular-nums ${isWinner ? "text-emerald-700" : "text-gray-900"}`}>
        {text}
        {row.suffix && <span className="ml-0.5 text-xs font-normal text-gray-400">{row.suffix}</span>}
      </span>
      {note && <span className="text-[11px] text-gray-400">{note}</span>}
    </span>
  );
}

export default function DetailsList({ sections, names, both, basis, campus = "danforth" }) {
  const [differences, setDifferences] = useState(false);
  const [active, setActive] = useState(sections[0]?.id ?? null);
  const chipRefs = useRef({});
  const navRef = useRef(null);

  const visible = sections
    .map((s) => ({ ...s, rows: both && differences ? s.rows.filter((r) => r.differs) : s.rows }))
    .filter((s) => s.rows.length > 0);

  // Light up the chip for whichever section is under the sticky bar.
  useEffect(() => {
    const headings = visible.map((s) => document.getElementById(`section-${s.id}`)).filter(Boolean);
    if (!headings.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const onScreen = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (onScreen[0]) setActive(onScreen[0].target.dataset.section);
      },
      { rootMargin: "-170px 0px -60% 0px", threshold: 0 }
    );
    headings.forEach((h) => observer.observe(h));
    return () => observer.disconnect();
  }, [visible.map((s) => s.id).join("|")]); // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll the chip strip only, never the page.
  useEffect(() => {
    const nav = navRef.current;
    const chip = chipRefs.current[active];
    if (!nav || !chip) return;
    nav.scrollTo({ left: Math.max(0, chip.offsetLeft - nav.clientWidth / 2 + chip.clientWidth / 2), behavior: "smooth" });
  }, [active]);

  const jump = (id) => document.getElementById(`section-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  const diffCount = sections.reduce((n, s) => n + s.rows.filter((r) => r.differs).length, 0);

  if (!sections.length) return null;

  const cols = "grid grid-cols-2 md:grid-cols-[1fr_230px_1fr] lg:grid-cols-[1fr_280px_1fr] xl:grid-cols-[1fr_320px_1fr]";

  return (
    <section className="mt-8" aria-label="Full comparison">
      {/* Pinned: names on the outside, section chips in the middle, differences toggle */}
      <div className={`sticky ${STICKY} z-30 -mx-4 border-b border-gray-200 bg-white px-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8`}>
        <div className="grid grid-cols-2 items-center gap-2 py-2 md:grid-cols-[1fr_auto_1fr]">
          <span className="truncate pr-2 text-center text-sm font-semibold text-gray-900 md:text-left">{names[0] ?? "First apartment"}</span>
          <nav ref={navRef} aria-label="Sections" className="col-span-2 order-last -mx-1 flex gap-1 overflow-x-auto px-1 pb-1 scrollbar-hidden md:order-none md:col-span-1 md:max-w-[52vw] md:pb-0">
            {visible.map((s) => (
              <button
                key={s.id}
                ref={(el) => (chipRefs.current[s.id] = el)}
                type="button"
                onClick={() => jump(s.id)}
                aria-current={active === s.id ? "location" : undefined}
                className={`shrink-0 rounded-md px-2.5 py-1 text-xs font-medium ${
                  active === s.id ? "bg-gray-900 text-white" : "text-gray-600 hover:bg-gray-100"
                }`}
              >
                {s.label}
              </button>
            ))}
          </nav>
          <span className="flex items-center justify-center gap-3 pl-2 md:justify-end">
            <span className="truncate text-sm font-semibold text-gray-900">{names[1] ?? "Second apartment"}</span>
            <button
              type="button"
              onClick={() => setDifferences((v) => !v)}
              disabled={!both}
              aria-pressed={both && differences}
              title="Show only rows that differ"
              className={`hidden h-7 shrink-0 items-center rounded-md border px-2 text-[11px] font-medium md:inline-flex ${
                both && differences ? "border-gray-900 bg-gray-900 text-white" : "border-gray-200 text-gray-600"
              } disabled:opacity-40`}
            >
              {both && differences ? `${diffCount} differences` : "Differences"}
            </button>
          </span>
        </div>
      </div>

      <div className="mt-4 overflow-hidden rounded-xl border border-gray-200">
        {visible.map((section) => (
          <div key={section.id} role="table" aria-label={section.label}>
            <h3
              id={`section-${section.id}`}
              data-section={section.id}
              className={`border-b border-gray-200 bg-gray-50 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-gray-600 ${SCROLL_MARGIN}`}
            >
              {section.label}
            </h3>
            <div role="row" className="sr-only">
              <span role="columnheader">{names[0] ?? "First apartment"}</span>
              <span role="columnheader">Detail</span>
              <span role="columnheader">{names[1] ?? "Second apartment"}</span>
            </div>
            {section.rows.map((row) => (
              <div key={row.id} role="row" className={`${cols} items-center gap-x-3 gap-y-1 border-b border-gray-100 px-3 py-2.5 last:border-b-0 md:gap-0 md:px-4`}>
                <div role="rowheader" className="col-span-2 text-center text-xs text-gray-500 md:order-2 md:col-span-1 md:text-[13px] md:text-gray-600">
                  {row.label}
                </div>
                <div role="cell" className="flex items-center justify-center px-1 text-center md:order-1">
                  <Value row={row} index={0} />
                </div>
                <div role="cell" className="flex items-center justify-center px-1 text-center md:order-3">
                  <Value row={row} index={1} />
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>

      <p className="mt-4 text-xs text-gray-500">
        A dash means the landlord hasn&apos;t told us. Rent is {basis === "unit" ? "for the whole apartment" : "per person"}, before utilities and fees. Walks go to {campus === "med" ? "the Med Campus" : "the Danforth University Center"}. Green marks the better number, or something one place has that the other doesn&apos;t.
      </p>
    </section>
  );
}
