"use client";

import { useId } from "react";
import { Info } from "lucide-react";

/*
 * A small "i" that explains the field next to it.
 *
 * Opens on hover and on focus, so it works from the keyboard and from a tap on
 * a phone (a tap focuses it). Pure CSS: there is no open state to get stuck.
 * The text is reset to normal case and weight because field labels here are
 * small uppercase captions, and a paragraph in that style is hard to read.
 */
export default function InfoTip({ children, label = "More info" }) {
  const id = useId();
  return (
    <span className="group relative inline-flex align-middle">
      <span
        tabIndex={0}
        role="button"
        aria-label={label}
        aria-describedby={id}
        onClick={(e) => e.preventDefault()}
        className="inline-flex cursor-help rounded-full text-gray-400 outline-none transition hover:text-gray-600 focus-visible:ring-2 focus-visible:ring-red-300"
      >
        <Info className="h-3.5 w-3.5" />
      </span>
      <span
        id={id}
        role="tooltip"
        className="pointer-events-none invisible absolute bottom-full left-0 z-50 mb-2 w-72 max-w-[80vw] rounded-lg bg-gray-900 px-3 py-2 text-xs font-normal normal-case leading-relaxed tracking-normal text-white opacity-0 shadow-lg transition group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100"
      >
        {children}
      </span>
    </span>
  );
}
