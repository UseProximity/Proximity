"use client";

/*
 * The panel of every available property, searchable, closest to campus
 * first. Used inline in an empty comparison slot on wide screens and inside a
 * sheet on phones, so both sides of the page offer the same list.
 */

import { useMemo, useRef, useState, useEffect } from "react";
import Image from "next/image";
import { Search, Star, Footprints, Bus, BedDouble } from "lucide-react";
import { campusLabel } from "@/lib/compare/fields";

export default function PickerList({ items, campus = "danforth", currentId, otherId, onChoose, autoFocus = false, className = "" }) {
  const inputRef = useRef(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (autoFocus) setTimeout(() => inputRef.current?.focus(), 30);
  }, [autoFocus]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const walkOf = (it) => (campus === "med" ? it.walkMed : it.walk) ?? Infinity;
    const sorted = [...items].sort((a, b) => walkOf(a) - walkOf(b) || a.name.localeCompare(b.name));
    if (!q) return sorted;
    return sorted.filter((it) => `${it.name} ${it.address}`.toLowerCase().includes(q));
  }, [items, query, campus]);

  return (
    <div className={`flex min-h-0 flex-col ${className}`}>
      <div className="border-b border-gray-200 p-3">
        <label className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 focus-within:border-red-400">
          <Search className="h-4 w-4 text-gray-400" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or street"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-gray-400"
          />
        </label>
        <p className="mt-1.5 text-[11px] text-gray-500">
          {results.length} apartments · walks to {campusLabel(campus)}
        </p>
      </div>
      <ul className="min-h-0 flex-1 divide-y divide-gray-100 overflow-y-auto">
        {results.length === 0 && (
          <li className="px-4 py-10 text-center text-sm text-gray-500">Nothing matches that. Try a street name.</li>
        )}
        {results.map((it) => {
          const taken = it.id === otherId;
          const current = it.id === currentId;
          const walk = campus === "med" ? it.walkMed : it.walk;
          return (
            <li key={it.id}>
              <button
                type="button"
                disabled={taken}
                onClick={() => onChoose(it.id)}
                className={`flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors ${
                  taken ? "opacity-40" : "hover:bg-gray-50"
                } ${current ? "bg-red-50/60" : ""}`}
              >
                <span className="relative h-12 w-16 shrink-0 overflow-hidden rounded-md bg-gray-100">
                  {it.image && <Image src={it.image} alt="" fill sizes="64px" className="object-cover" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-semibold text-gray-900">{it.name}</span>
                    <span className="shrink-0 text-sm font-semibold text-gray-900">
                      {it.rent === "Contact for Pricing" ? "Ask" : it.rent}
                      {it.rent !== "Contact for Pricing" && <span className="text-xs font-normal text-gray-500">/mo</span>}
                    </span>
                  </span>
                  <span className="block truncate text-xs text-gray-500">{it.address.split(",")[0]}</span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-gray-600">
                    {it.bedBath && (
                      <span className="inline-flex items-center gap-1">
                        <BedDouble className="h-3 w-3 text-gray-400" />
                        {it.bedBath}
                      </span>
                    )}
                    {walk != null && (
                      <span className="inline-flex items-center gap-1">
                        <Footprints className="h-3 w-3 text-gray-400" />
                        {walk} min
                      </span>
                    )}
                    {it.shuttle != null && (
                      <span className="inline-flex items-center gap-1">
                        <Bus className="h-3 w-3 text-gray-400" />
                        {it.shuttle} min
                      </span>
                    )}
                    {it.rating != null && (
                      <span className="inline-flex items-center gap-0.5">
                        <Star className="h-3 w-3 fill-red-400 text-red-400" />
                        {it.rating.toFixed(1)}
                      </span>
                    )}
                  </span>
                </span>
                {taken && <span className="shrink-0 text-[11px] font-medium text-gray-500">Other side</span>}
                {current && <span className="shrink-0 text-[11px] font-medium text-red-600">Current</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
