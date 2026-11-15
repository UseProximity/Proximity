"use client";

import { useEffect, useRef, useState } from "react";

/*
 * "View as" in the admin header: find a person and open their dashboard or their
 * Messages inbox exactly as they see it, read only. The search always looks in
 * this site's own database, whatever the dev/prod switch says.
 */
export default function ViewAsMenu({ isProd }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const timerRef = useRef(null);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  function handleSearch(q) {
    setQuery(q);
    clearTimeout(timerRef.current);
    if (!q || q.length < 2) { setResults([]); return; }
    timerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/searchUsers?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        setResults(Array.isArray(data) ? data.slice(0, 6) : []);
      } catch {
        setResults([]);
      }
    }, 300);
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`px-3 py-1 text-xs rounded border font-medium transition-colors ${
          isProd ? "border-red-500 text-red-200 hover:bg-red-800" : "border-gray-600 text-gray-300 hover:bg-gray-700"
        }`}
      >
        View as ▾
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-80 bg-white border border-gray-200 rounded-xl shadow-xl z-50 p-4 text-gray-800">
          <p className="text-xs font-semibold text-gray-700 mb-1">View as user</p>
          <input
            type="text"
            value={query}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Search by name or email…"
            className="w-full px-2 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:border-blue-400"
          />
          {results.length > 0 && (
            <ul className="mt-1 border border-gray-100 rounded divide-y divide-gray-100 max-h-48 overflow-y-auto">
              {results.map((u) => (
                <li key={u.id} className="flex items-center justify-between gap-2 px-2 py-1.5">
                  <div className="min-w-0">
                    <p className="text-xs font-medium truncate">{u.name || "(no name)"}</p>
                    <p className="text-[10px] text-gray-400 truncate">{u.email}</p>
                  </div>
                  <a
                    href={`/dashboard/view-as/${u.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[11px] px-2 py-0.5 bg-gray-800 text-white rounded hover:bg-gray-700 whitespace-nowrap"
                  >
                    View →
                  </a>
                  <a
                    href={`/?messages=1&messagesAs=${u.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Their Messages inbox exactly as they see it, read only"
                    className="text-[11px] px-2 py-0.5 border border-gray-300 text-gray-700 rounded hover:bg-gray-50 whitespace-nowrap"
                  >
                    Inbox →
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
