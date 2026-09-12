"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { Search, X, Star, Footprints, Bus, BedDouble } from "lucide-react";
import { campusLabel } from "@/lib/compare/fields";

/* Searchable list of every available property, in a native dialog so focus,
 * Escape and scroll locking come for free. */
export default function PropertyPicker({ open, slot, items, campus = "danforth", currentId, otherId, onChoose, onClose }) {
  const ref = useRef(null);
  const inputRef = useRef(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
      setQuery("");
      setTimeout(() => inputRef.current?.focus(), 30);
    } else if (!open && el.open) {
      el.close();
    }
  }, [open]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const walkOf = (it) => (campus === "med" ? it.walkMed : it.walk) ?? Infinity;
    const sorted = [...items].sort((a, b) => walkOf(a) - walkOf(b) || a.name.localeCompare(b.name));
    if (!q) return sorted;
    return sorted.filter((it) => `${it.name} ${it.address}`.toLowerCase().includes(q));
  }, [items, query, campus]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className="m-0 h-[100dvh] max-h-none w-full max-w-none bg-transparent p-0 backdrop:bg-black/50 backdrop:backdrop-blur-sm sm:m-auto sm:h-auto sm:max-h-[85vh] sm:w-[36rem]"
    >
      <div className="flex h-full max-h-[100dvh] flex-col bg-white sm:max-h-[85vh] sm:rounded-2xl sm:shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-5 py-4">
          <div>
            <h2 className="text-lg font-bold tracking-tight text-gray-900">
              {slot === 0 ? "Pick your first option" : "Pick the other option"}
            </h2>
            <p className="text-xs text-gray-500">{items.length} apartments. Walks go to {campusLabel(campus)}.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-9 w-9 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="px-5 py-3">
          <label className="flex items-center gap-2 rounded-full border border-gray-200 bg-gray-50 px-4 py-2.5 focus-within:border-red-400 focus-within:bg-white">
            <Search className="h-4 w-4 text-gray-400" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Name or street"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-gray-400"
            />
          </label>
        </div>
        <ul className="flex-1 overflow-y-auto px-2 pb-3">
          {results.length === 0 && (
            <li className="px-4 py-10 text-center text-sm text-gray-500">Nothing matches that. Try a street name.</li>
          )}
          {results.map((it) => {
            const taken = it.id === otherId;
            const current = it.id === currentId;
            return (
              <li key={it.id}>
                <button
                  type="button"
                  disabled={taken}
                  onClick={() => onChoose(it.id)}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${
                    taken ? "opacity-40" : "hover:bg-gray-50"
                  } ${current ? "bg-red-50/60" : ""}`}
                >
                  <span className="relative h-14 w-20 shrink-0 overflow-hidden rounded-lg bg-gray-100">
                    {it.image && <Image src={it.image} alt="" fill sizes="80px" className="object-cover" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-gray-900">{it.name}</span>
                    <span className="block truncate text-xs text-gray-500">{it.address}</span>
                    <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-gray-600">
                      <span className="font-semibold text-gray-900">{it.rent}{it.rent !== "Contact for Pricing" ? "/mo" : ""}</span>
                      {it.bedBath && (
                        <span className="inline-flex items-center gap-1 text-gray-600">
                          <BedDouble className="h-3 w-3" />
                          {it.bedBath}
                        </span>
                      )}
                      {(campus === "med" ? it.walkMed : it.walk) != null && (
                        <span className="inline-flex items-center gap-1 text-gray-500">
                          <Footprints className="h-3 w-3" />
                          {campus === "med" ? it.walkMed : it.walk} min
                        </span>
                      )}
                      {it.shuttle != null && (
                        <span className="inline-flex items-center gap-1 text-gray-500">
                          <Bus className="h-3 w-3" />
                          {it.shuttle} min
                        </span>
                      )}
                      {it.rating != null && (
                        <span className="inline-flex items-center gap-0.5 text-gray-500">
                          <Star className="h-3 w-3 fill-red-400 text-red-400" />
                          {it.rating.toFixed(1)}
                        </span>
                      )}
                    </span>
                  </span>
                  {taken && <span className="text-[11px] font-medium text-gray-500">Other side</span>}
                  {current && <span className="text-[11px] font-medium text-red-600">Current</span>}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </dialog>
  );
}
