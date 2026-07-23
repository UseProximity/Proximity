"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";

const SEVERITY_STYLES = {
  red: "bg-red-50 border border-red-200 text-red-700",
  yellow: "border border-amber-400 bg-amber-50 text-amber-900",
  green: "border border-emerald-200 bg-emerald-50 text-emerald-800",
};

const SEVERITY_LABELS = {
  red: "Red flag",
  yellow: "Worth asking about",
  green: "Good sign",
};

// Collapsed by default: severity + title only. Expanding reveals the explanation,
// the quoted clause, and the question to ask the landlord.
export default function FlagCard({ flag }) {
  const [open, setOpen] = useState(false);
  const style = SEVERITY_STYLES[flag.severity] ?? SEVERITY_STYLES.yellow;

  return (
    <div className={`rounded-2xl ${style}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 p-5 text-left"
      >
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] opacity-70">
            {SEVERITY_LABELS[flag.severity] ?? flag.severity}
          </p>
          <h3 className="mt-0.5 text-base font-bold">{flag.title}</h3>
        </div>
        <ChevronDown
          size={18}
          className={`shrink-0 opacity-60 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="px-5 pb-5">
          <p className="text-sm leading-6">{flag.explanation}</p>
          {flag.quote && (
            <blockquote className="mt-3 border-l-2 border-gray-300 pl-3 text-xs italic opacity-80">
              &ldquo;{flag.quote}&rdquo;
            </blockquote>
          )}
          <p className="mt-3 text-sm">
            <span className="font-semibold">Ask the landlord:</span> {flag.question}
          </p>
        </div>
      )}
    </div>
  );
}
