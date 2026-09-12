"use client";

/*
 * Every comparison row, in one continuous list.
 *
 * Nothing is folded away: each section has a heading, a slim bar stays pinned
 * under the site header with both property names and one chip per section,
 * and the chip for the section on screen lights up as the student scrolls.
 */

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Check, Minus, ArrowDown, ArrowUp } from "lucide-react";

// The site header is 83px tall on phones and 104px from md up.
const STICKY = "top-[83px] md:top-[104px]";
const SCROLL_MARGIN = "scroll-mt-[150px] md:scroll-mt-[176px]";

function Value({ row, index }) {
  const v = row.values[index];
  const text = row.display[index];
  const note = row.notes[index];
  const isWinner = row.winner === index;

  if (v == null) {
    return <span className="text-sm text-gray-300">Not listed</span>;
  }
  if (row.type === "boolean") {
    return v ? (
      <span className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-900">
        <Check className="h-4 w-4 text-emerald-600" strokeWidth={2.5} />
        Yes
      </span>
    ) : (
      <span className="inline-flex items-center gap-1.5 text-sm text-gray-400">
        <Minus className="h-4 w-4" />
        No
      </span>
    );
  }
  if (row.type === "link") {
    return (
      <a href={v} target="_blank" rel="noreferrer" className="text-sm font-medium text-red-600 underline underline-offset-4">
        {text}
      </a>
    );
  }
  if (row.type === "quote") {
    return <q className="line-clamp-4 text-sm italic leading-relaxed text-gray-600">{v}</q>;
  }
  return (
    <span className="inline-flex flex-col items-center">
      <span
        className={`inline-flex items-center gap-1 text-sm font-semibold tabular-nums ${
          isWinner ? "text-emerald-700" : "text-gray-900"
        }`}
      >
        {isWinner && (row.type === "money" || row.type === "minutes" ? <ArrowDown className="h-3.5 w-3.5" /> : <ArrowUp className="h-3.5 w-3.5" />)}
        {text}
        {row.suffix && <span className="font-normal text-gray-400"> {row.suffix}</span>}
      </span>
      {note && <span className="mt-0.5 text-[11px] text-gray-400">{note}</span>}
    </span>
  );
}

export default function DetailsList({ sections, names, both, basis }) {
  const [differences, setDifferences] = useState(false);
  const [active, setActive] = useState(sections[0]?.id ?? null);
  const chipRefs = useRef({});

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
      { rootMargin: "-180px 0px -60% 0px", threshold: 0 }
    );
    headings.forEach((h) => observer.observe(h));
    return () => observer.disconnect();
  }, [visible.map((s) => s.id).join("|")]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the active chip in view by scrolling the chip strip only. Never the
  // page: scrollIntoView would drag the whole document to the bar on load.
  const navRef = useRef(null);
  useEffect(() => {
    const nav = navRef.current;
    const chip = chipRefs.current[active];
    if (!nav || !chip) return;
    const target = chip.offsetLeft - nav.clientWidth / 2 + chip.clientWidth / 2;
    nav.scrollTo({ left: Math.max(0, target), behavior: "smooth" });
  }, [active]);

  const jump = (id) => {
    document.getElementById(`section-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const total = sections.reduce((n, s) => n + s.rows.length, 0);
  const diffCount = sections.reduce((n, s) => n + s.rows.filter((r) => r.differs).length, 0);

  if (!sections.length) return null;

  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1], delay: 0.5 }}
      className="mt-12"
      aria-label="Full comparison"
    >
      <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-gray-900">The details</h2>
          <p className="mt-1 text-sm text-gray-500">
            {both && differences ? `${diffCount} of ${total} rows differ.` : `${total} rows. Jump to any section above the list.`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setDifferences((v) => !v)}
          disabled={!both}
          aria-pressed={both && differences}
          className="inline-flex min-h-10 items-center gap-2.5 rounded-full border border-gray-200 px-4 text-sm font-medium text-gray-700 disabled:opacity-40"
        >
          Differences only
          <span
            aria-hidden="true"
            className={`flex h-5 w-9 items-center rounded-full p-0.5 transition-colors ${both && differences ? "bg-gray-900" : "bg-gray-200"}`}
          >
            <span className={`h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${both && differences ? "translate-x-4" : ""}`} />
          </span>
        </button>
      </div>

      {/* Pinned: names on the outside, section chips in the middle */}
      <div className={`sticky ${STICKY} z-30 -mx-4 border-y border-gray-100 bg-white/95 px-4 backdrop-blur-lg sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8`}>
        <div className="grid grid-cols-2 items-center gap-2 py-2.5 text-sm font-semibold text-gray-900 md:grid-cols-[1fr_auto_1fr]">
          <span className="truncate pr-2 text-center md:text-left">{names[0] ?? "Option 1"}</span>
          <nav ref={navRef} aria-label="Sections" className="col-span-2 order-last -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 scrollbar-hidden md:order-none md:col-span-1 md:max-w-[52vw] md:pb-0">
            {visible.map((s) => (
              <button
                key={s.id}
                ref={(el) => (chipRefs.current[s.id] = el)}
                type="button"
                onClick={() => jump(s.id)}
                aria-current={active === s.id ? "location" : undefined}
                className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                  active === s.id ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                {s.label}
              </button>
            ))}
          </nav>
          <span className="truncate pl-2 text-center md:text-right">{names[1] ?? "Option 2"}</span>
        </div>
      </div>

      {visible.map((section) => (
        <div key={section.id} className="pt-8">
          <h3
            id={`section-${section.id}`}
            data-section={section.id}
            className={`mb-2 flex items-baseline gap-3 text-lg font-bold tracking-tight text-gray-900 ${SCROLL_MARGIN}`}
          >
            {section.label}
            <span className="text-xs font-normal text-gray-400">{section.rows.length}</span>
          </h3>
          <div role="table" aria-label={section.label} className="overflow-hidden rounded-2xl border border-gray-100">
            <div role="row" className="sr-only">
              <span role="columnheader">{names[0] ?? "Option 1"}</span>
              <span role="columnheader">Detail</span>
              <span role="columnheader">{names[1] ?? "Option 2"}</span>
            </div>
            {section.rows.map((row, i) => (
              <div
                key={row.id}
                role="row"
                className={`grid grid-cols-2 gap-x-3 gap-y-1.5 px-3 py-3.5 md:grid-cols-[1fr_180px_1fr] md:gap-0 md:px-4 lg:grid-cols-[1fr_220px_1fr] ${
                  i % 2 === 1 ? "bg-gray-50/70" : "bg-white"
                }`}
              >
                <div role="rowheader" className="col-span-2 text-center text-xs text-gray-500 md:order-2 md:col-span-1 md:self-center md:text-[13px]">
                  {row.label}
                </div>
                <div role="cell" className="flex items-center justify-center text-center md:order-1">
                  <Value row={row} index={0} />
                </div>
                <div role="cell" className="flex items-center justify-center text-center md:order-3">
                  <Value row={row} index={1} />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      <p className="mt-8 text-center text-xs leading-relaxed text-gray-400">
        Not listed means we don&apos;t have that detail yet. It never means no.
        <br />
        Rent is {basis === "unit" ? "for the whole apartment" : "per person"} before utilities and fees. Walk times all go to the same campus spot.
      </p>
    </motion.section>
  );
}
