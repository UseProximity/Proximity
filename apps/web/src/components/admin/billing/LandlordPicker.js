"use client";

import { useEffect, useState } from "react";
import { billingFetch } from "@/components/admin/billing/billingFetch";

const FIELD =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-500";

export const landlordName = (l) => l?.name || l?.company || l?.email || "Landlord";

/*
 * Pick one landlord account by name, email or company. Shows the chosen one with
 * a Change link; `onChange(null)` clears it.
 */
export default function LandlordPicker({ value, onChange, disabled = false }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (value) return undefined;
    let stale = false;
    const t = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await billingFetch(`/api/admin/billing/landlords/search?q=${encodeURIComponent(query.trim())}`);
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || "Could not search landlords.");
        if (!stale) setResults(body.landlords ?? []);
      } catch (err) {
        if (!stale) setError(err.message);
      } finally {
        if (!stale) setLoading(false);
      }
    }, 250);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [query, value]);

  if (value) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
        <div className="min-w-0 flex-1 text-sm">
          <p className="truncate font-medium text-gray-900">{landlordName(value)}</p>
          <p className="truncate text-xs text-gray-500">{[value.company, value.email].filter(Boolean).join(" · ")}</p>
        </div>
        <button type="button" disabled={disabled} className="text-sm text-gray-600 underline disabled:opacity-60" onClick={() => onChange(null)}>
          Change
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <input
        className={FIELD}
        value={query}
        disabled={disabled}
        placeholder="Search by name, email or company"
        onChange={(e) => setQuery(e.target.value)}
      />
      {error && <p className="text-xs text-red-700">{error}</p>}
      <ul className="max-h-56 overflow-y-auto rounded-lg border border-gray-100 divide-y divide-gray-100">
        {results.map((l) => (
          <li key={l.id}>
            <button type="button" disabled={disabled} className="w-full px-3 py-2 text-left hover:bg-gray-50" onClick={() => onChange(l)}>
              <span className="block text-sm text-gray-900">{landlordName(l)}</span>
              <span className="block text-xs text-gray-500">{[l.company, l.email].filter(Boolean).join(" · ")}</span>
            </button>
          </li>
        ))}
        {!loading && !results.length && <li className="px-3 py-2 text-sm text-gray-500">No landlords match.</li>}
        {loading && !results.length && <li className="px-3 py-2 text-sm text-gray-500">Searching...</li>}
      </ul>
    </div>
  );
}
