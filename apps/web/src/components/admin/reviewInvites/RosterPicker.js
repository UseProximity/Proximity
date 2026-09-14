"use client";

/*
 * Choosing who gets a review invite.
 *
 * Two ways in, because they answer different questions. Searching and ticking
 * boxes is for "email these specific people"; the random draw is for "just give
 * me 200 students we have not asked yet", which is what a campaign actually
 * wants and which nobody would do by hand over 6,595 rows.
 *
 * Selection is held by the parent as a Map keyed by roster id, so it survives
 * searching, filtering and paging. Ticking someone, searching for someone else,
 * and ticking them too has to add up to two recipients rather than one.
 *
 * A MISSING FIRST NAME IS SHOWN, NOT HIDDEN. Roughly a fifth of the roster has
 * no first name, and a message that says "Hi {first_name}" turns those into
 * "Hi ,". The random draw refuses to pick them at all; the manual table lets you
 * pick them but flags the row, because a message with no {first_name} in it is
 * perfectly fine to send them.
 */

import { useState, useEffect, useCallback } from "react";

const PAGE_SIZE = 50;

const STATUS_FILTERS = [
  { key: "uncontacted", label: "Not contacted" },
  { key: "contacted", label: "Contacted" },
  { key: "all", label: "Everyone" },
];

function SentCell({ row }) {
  if (row.review_written_at) {
    return <span className="text-green-700 font-semibold">Reviewed</span>;
  }
  if (row.invited) {
    return (
      <span className="text-blue-700">
        Sent{row.last_invited_at ? ` ${new Date(row.last_invited_at).toLocaleDateString()}` : ""}
      </span>
    );
  }
  return <span className="text-gray-400">Not contacted</span>;
}

export default function RosterPicker({ selected, onToggle, onAddMany, onClear }) {
  const [rows, setRows] = useState([]);
  const [counts, setCounts] = useState({});
  const [matched, setMatched] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [status, setStatus] = useState("uncontacted");
  const [withFirstName, setWithFirstName] = useState(false);
  const [page, setPage] = useState(0);

  const [sampleSize, setSampleSize] = useState(100);
  const [sampling, setSampling] = useState(false);
  const [sampleNote, setSampleNote] = useState(null);

  // Typing in the search box should not fire a request per keystroke against a
  // 6,595-row view.
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedQ(q);
      setPage(0);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        q: debouncedQ,
        status,
        limit: String(PAGE_SIZE),
        offset: String(page * PAGE_SIZE),
      });
      if (withFirstName) params.set("withFirstName", "1");
      const res = await fetch(`/api/admin/roster?${params}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to load students");
      setRows(data.rows || []);
      setMatched(data.matched || 0);
      setCounts(data.counts || {});
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [debouncedQ, status, withFirstName, page]);

  useEffect(() => {
    load();
  }, [load]);

  async function drawRandom() {
    setSampling(true);
    setSampleNote(null);
    try {
      const res = await fetch(`/api/admin/roster?sample=${Math.max(1, sampleSize)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to draw");
      const picked = data.rows || [];
      onAddMany(picked);
      setSampleNote(
        picked.length < sampleSize
          ? `Only ${picked.length} students left who have a first name and have not been contacted.`
          : `Added ${picked.length} students.`
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setSampling(false);
    }
  }

  const pageStart = page * PAGE_SIZE;
  const lastPage = Math.max(0, Math.ceil(matched / PAGE_SIZE) - 1);
  const allOnPageSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));

  return (
    <div className="space-y-3">
      {/* Random draw: the campaign path. */}
      <div className="p-3 rounded-xl border border-gray-200 bg-white">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-gray-700">Pick at random:</span>
          <input
            type="number"
            min={1}
            max={1000}
            value={sampleSize}
            onChange={(e) => setSampleSize(Number(e.target.value))}
            className="w-20 px-2 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:border-blue-400"
          />
          <button
            type="button"
            onClick={drawRandom}
            disabled={sampling}
            className="px-3 py-1.5 text-xs font-semibold bg-gray-800 hover:bg-gray-700 text-white rounded disabled:opacity-50"
          >
            {sampling ? "Drawing…" : "Add to selection"}
          </button>
          <span className="text-xs text-gray-500">
            never contacted, first name on file ({counts.sendable ?? 0} available)
          </span>
        </div>
        {sampleNote && <p className="mt-1.5 text-xs text-gray-600">{sampleNote}</p>}
        {counts.missingFirstName > 0 && (
          <p className="mt-1.5 text-xs text-amber-700">
            {counts.missingFirstName} of {counts.total} students have no first name and
            are never drawn at random. You can still tick them by hand below, as long
            as your message does not use {"{first_name}"}.
          </p>
        )}
      </div>

      {/* Manual search. */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name or email…"
          className="flex-1 min-w-[200px] px-2 py-1.5 text-xs border border-gray-300 rounded focus:outline-none focus:border-blue-400"
        />
        <div className="flex rounded overflow-hidden border border-gray-300">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => {
                setStatus(f.key);
                setPage(0);
              }}
              className={`px-2.5 py-1.5 text-xs font-semibold ${
                status === f.key ? "bg-gray-800 text-white" : "bg-white text-gray-600 hover:bg-gray-50"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-xs text-gray-600">
          <input
            type="checkbox"
            checked={withFirstName}
            onChange={(e) => {
              setWithFirstName(e.target.checked);
              setPage(0);
            }}
            className="h-3.5 w-3.5 rounded border-gray-300"
          />
          Has first name
        </label>
      </div>

      {error && (
        <div className="px-3 py-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded">
          {error}
        </div>
      )}

      <div className="flex items-center justify-between text-xs text-gray-500">
        <span>
          {matched.toLocaleString()} match{matched === 1 ? "" : "es"}
          {selected.size > 0 && (
            <>
              {" · "}
              <span className="font-semibold text-gray-800">
                {selected.size.toLocaleString()} selected
              </span>
              {" · "}
              <button type="button" onClick={onClear} className="underline hover:text-gray-800">
                clear
              </button>
            </>
          )}
        </span>
        <span className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="px-2 py-1 rounded bg-gray-200 hover:bg-gray-300 disabled:opacity-40"
          >
            Prev
          </button>
          <span>
            {matched === 0 ? 0 : pageStart + 1}-{Math.min(pageStart + PAGE_SIZE, matched)}
          </span>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(lastPage, p + 1))}
            disabled={page >= lastPage}
            className="px-2 py-1 rounded bg-gray-200 hover:bg-gray-300 disabled:opacity-40"
          >
            Next
          </button>
        </span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white max-h-[420px] overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 text-gray-600 sticky top-0">
            <tr>
              <th className="px-3 py-2 w-8">
                <input
                  type="checkbox"
                  checked={allOnPageSelected}
                  onChange={() =>
                    allOnPageSelected
                      ? rows.forEach((r) => selected.has(r.id) && onToggle(r))
                      : onAddMany(rows)
                  }
                  className="h-3.5 w-3.5 rounded border-gray-300"
                  aria-label="Select all on this page"
                />
              </th>
              <th className="text-left px-3 py-2 font-semibold">Email</th>
              <th className="text-left px-3 py-2 font-semibold">First name</th>
              <th className="text-left px-3 py-2 font-semibold">Last name</th>
              <th className="text-left px-3 py-2 font-semibold">Class</th>
              <th className="text-left px-3 py-2 font-semibold">Sent</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="px-3 py-10 text-center text-gray-400">
                  Loading students…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-10 text-center text-gray-400">
                  No students match that.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr
                  key={r.id}
                  className={`border-t border-gray-100 ${
                    selected.has(r.id) ? "bg-blue-50/60" : ""
                  }`}
                >
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={selected.has(r.id)}
                      onChange={() => onToggle(r)}
                      className="h-3.5 w-3.5 rounded border-gray-300"
                      aria-label={`Select ${r.email}`}
                    />
                  </td>
                  <td className="px-3 py-2 font-medium text-gray-900">{r.email}</td>
                  <td className="px-3 py-2">
                    {r.has_first_name ? (
                      <span className="text-gray-700">{r.first_name}</span>
                    ) : (
                      <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-semibold">
                        none
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-gray-600">{r.last_name || "-"}</td>
                  <td className="px-3 py-2 text-gray-600">{r.class_year || "-"}</td>
                  <td className="px-3 py-2">
                    <SentCell row={r} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
