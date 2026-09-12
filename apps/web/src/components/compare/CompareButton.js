"use client";

/*
 * The "Compare" pill that lives on listing cards and listing headers.
 *
 * Behaviour, in order:
 *   - already in the comparison  -> open it
 *   - a slot is free             -> take it and open the comparison
 *   - both slots taken           -> open the comparison and ask which to replace
 * Nothing is ever dropped silently.
 */

import { useRouter } from "next/navigation";
import { Columns2, Check } from "lucide-react";
import { useCompare } from "@/context/CompareContext";
import { compareHref } from "@/lib/compare/model";
import { trackEvent } from "@/utils/analytics";

export default function CompareButton({ listingId, variant = "chip", className = "" }) {
  const router = useRouter();
  const { ids, setIds } = useCompare();
  const id = String(listingId);
  const active = ids.includes(id);

  const handleClick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (active) {
      router.push(compareHref(ids));
      return;
    }
    if (ids.length < 2) {
      const next = ids.length === 0 ? [id] : [ids[0], id];
      setIds(next);
      trackEvent("Compare Added", { listingId: id, slot: next.length });
      router.push(compareHref(next));
      return;
    }
    trackEvent("Compare Replace Prompted", { listingId: id });
    router.push(compareHref(ids, { add: id }));
  };

  const label = active ? "Comparing" : "Compare";
  const Icon = active ? Check : Columns2;

  if (variant === "outline") {
    return (
      <button
        type="button"
        onClick={handleClick}
        aria-pressed={active}
        className={`inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold transition-colors ${
          active
            ? "border-red-600 bg-red-600 text-white hover:bg-red-700"
            : "border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:text-gray-900"
        } ${className}`}
      >
        <Icon className="h-4 w-4" strokeWidth={2.2} />
        {label}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-pressed={active}
      aria-label={active ? "Open comparison" : "Add to comparison"}
      className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-semibold shadow-md backdrop-blur-md transition-colors ${
        active
          ? "bg-red-600 text-white hover:bg-red-700"
          : "border border-white/60 bg-white/90 text-gray-800 hover:bg-white"
      } ${className}`}
    >
      <Icon className="h-3.5 w-3.5" strokeWidth={2.4} />
      {label}
    </button>
  );
}
