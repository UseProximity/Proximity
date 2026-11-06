"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";

/*
 * A Payments tab card that folds to its header. It starts open when the landlord
 * has something to do in it (`defaultOpen`) and closed otherwise, with `summary`
 * saying where things stand in the header either way.
 */
export default function CollapsibleSection({ id, title, badge = null, summary = null, defaultOpen = true, banner = null, children }) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = `${id}-body`;
  return (
    <section id={id} className="scroll-mt-24 bg-white rounded-lg border border-gray-100 shadow-sm">
      {banner}
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((o) => !o)}
        className={`flex w-full items-start gap-3 px-4 py-4 text-left ${open ? "border-b border-gray-100" : ""}`}
      >
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-3">
            <span className="text-base font-semibold text-gray-900">{title}</span>
            {badge}
          </span>
          {summary && <span className="mt-1 block text-sm text-gray-500">{summary}</span>}
        </span>
        <ChevronDown className={`mt-0.5 h-5 w-5 shrink-0 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
        <span className="sr-only">{open ? "Collapse" : "Expand"}</span>
      </button>
      {open && <div id={bodyId}>{children}</div>}
    </section>
  );
}
