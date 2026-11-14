"use client";

/*
 * The admin header's "find a person or listing" box (Wyatt, 2026-11-12). Type a
 * name, email, address or paste an id, pick a result, and its record opens.
 * It searches the database the dev/prod switch points at.
 */
import { useEffect, useRef, useState } from "react";
import { adminFetch, Badge, useAdminNav } from "@/components/admin/adminShared";
import { listingPath, personPath } from "@/components/admin/adminNav";

const STATE_COLORS = { published: "green", draft: "amber", hidden: "gray", deleted: "red" };

export default function GlobalSearch({ dbTarget }) {
  const nav = useAdminNav();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const ref = useRef(null);
  const timer = useRef(null);
  const latest = useRef(0);

  useEffect(() => {
    function onClick(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  function onChange(value) {
    setQuery(value);
    setOpen(true);
    setActive(0);
    clearTimeout(timer.current);
    if (value.trim().length < 2) { setResults(null); return; }
    timer.current = setTimeout(async () => {
      const mine = ++latest.current;
      try {
        const d = await adminFetch(`/api/admin/search?q=${encodeURIComponent(value.trim())}`, dbTarget);
        // A slower earlier answer must not replace a newer one.
        if (mine === latest.current) setResults(d);
      } catch {
        if (mine === latest.current) setResults({ people: [], listings: [], failed: true });
      }
    }, 250);
  }

  const items = results
    ? [...results.people.map((p) => ({ kind: "person", ...p })), ...results.listings.map((l) => ({ kind: "listing", ...l }))]
    : [];

  function pick(item) {
    if (!item) return;
    setOpen(false);
    setQuery("");
    setResults(null);
    nav?.goTo(item.kind === "person" ? personPath(item.id) : listingPath(item.id));
  }

  function onKeyDown(e) {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(i + 1, items.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); pick(items[active]); }
    else if (e.key === "Escape") setOpen(false);
  }

  return (
    <div ref={ref} className="relative">
      <input
        type="search"
        value={query}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder="Find a person or listing…"
        aria-label="Find a person or listing"
        className="w-64 px-3 py-1.5 text-sm rounded-lg bg-white text-gray-900 border border-gray-300 placeholder-gray-400 focus:outline-none focus:border-blue-400"
      />
      {open && results && (
        <div className="absolute right-0 top-full z-50 mt-1 w-96 max-w-[90vw] overflow-hidden rounded-xl border border-gray-200 bg-white text-gray-800 shadow-xl">
          {items.length === 0 && <p className="px-3 py-3 text-sm text-gray-500">{results.failed ? "Search failed. Try again." : "No one and nothing matches."}</p>}
          {items.map((item, i) => (
            <button
              key={`${item.kind}-${item.id}`}
              type="button"
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(item)}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm ${i === active ? "bg-gray-100" : ""}`}
            >
              <span className="w-14 flex-shrink-0 text-[10px] font-semibold uppercase tracking-wide text-gray-400">{item.kind === "person" ? "Person" : "Listing"}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-gray-900">{item.kind === "person" ? item.name || item.email || "Unnamed account" : item.label}</span>
                <span className="block truncate text-xs text-gray-500">{item.kind === "person" ? item.email : item.address}</span>
              </span>
              {item.kind === "person" ? <Badge color={item.deleted ? "red" : "gray"}>{item.deleted ? "deleted" : item.role}</Badge> : <Badge color={STATE_COLORS[item.state]}>{item.state}</Badge>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
