"use client";

/*
 * The "Compare" button on a listing's own page or panel. Opens the
 * comparison with this listing filling the first free side. If both sides
 * are already taken, the page asks which one to replace.
 */

import { useRouter } from "next/navigation";
import { Columns2, Check } from "lucide-react";
import { useCompare, compareItem } from "@/context/CompareContext";
import { compareHref } from "@/lib/compare/model";
import { trackEvent } from "@/utils/analytics";

export default function CompareButton({ listing, className = "" }) {
  const router = useRouter();
  const { items, ids, setItems } = useCompare();
  const item = compareItem(listing);
  const active = ids.includes(item.id);

  const handleClick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (active) return router.push(compareHref(ids));
    if (ids.length < 2) {
      setItems(ids.length === 0 ? [item] : [items[0], item]);
      trackEvent("Compare Opened", { listingId: item.id, from: "listing" });
      return router.push(compareHref([...ids, item.id]));
    }
    trackEvent("Compare Replace Prompted", { listingId: item.id });
    router.push(compareHref(ids, { add: item.id }));
  };

  const Icon = active ? Check : Columns2;
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
      {active ? "Comparing" : "Compare"}
    </button>
  );
}
