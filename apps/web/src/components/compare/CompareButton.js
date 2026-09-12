"use client";

/*
 * The "Compare" pill.
 *
 * Two behaviours, because the two places it lives mean different things:
 *
 *   chip (listing cards on Browse): a pick toggle. First tap adds the listing
 *   to the shortlist and the tray at the bottom says "pick one more"; the
 *   second tap on another card opens the comparison with both. Tapping a
 *   picked card again un-picks it. A third pick opens the comparison and
 *   asks which one to replace, so nothing is dropped silently.
 *
 *   outline (a listing's own page or panel): the student is already looking
 *   at one place, so this opens the comparison straight away with that
 *   listing on the left.
 */

import { useRouter } from "next/navigation";
import { Columns2, Check } from "lucide-react";
import { useCompare, compareItem } from "@/context/CompareContext";
import { compareHref } from "@/lib/compare/model";
import { trackEvent } from "@/utils/analytics";

export default function CompareButton({ listing, variant = "chip", className = "" }) {
  const router = useRouter();
  const { items, ids, add, remove, setItems } = useCompare();
  const item = compareItem(listing);
  const active = ids.includes(item.id);

  const open = (nextIds, extra) => {
    // Full slots and a third pick: the page shows the replace prompt.
    router.push(compareHref(nextIds, extra));
  };

  const handleClick = (e) => {
    e.preventDefault();
    e.stopPropagation();

    if (variant === "outline") {
      if (active) return open(ids);
      if (ids.length < 2) {
        setItems(ids.length === 0 ? [item] : [items[0], item]);
        trackEvent("Compare Opened", { listingId: item.id, from: "listing" });
        return open([...ids, item.id]);
      }
      trackEvent("Compare Replace Prompted", { listingId: item.id });
      return open(ids, { add: item.id });
    }

    if (active) {
      remove(item.id);
      trackEvent("Compare Unpicked", { listingId: item.id });
      return;
    }
    if (ids.length === 0) {
      add(item);
      trackEvent("Compare Picked", { listingId: item.id, slot: 1 });
      return;
    }
    if (ids.length === 1) {
      add(item);
      trackEvent("Compare Picked", { listingId: item.id, slot: 2 });
      return open([ids[0], item.id]);
    }
    trackEvent("Compare Replace Prompted", { listingId: item.id });
    open(ids, { add: item.id });
  };

  const label = active ? (variant === "outline" ? "Comparing" : "Picked") : "Compare";
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
      aria-label={active ? "Remove from comparison" : "Pick for comparison"}
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
