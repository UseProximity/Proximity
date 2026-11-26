"use client";

import { useEffect, useState } from "react";
import { adminFetch, Badge } from "@/components/admin/adminShared";

/*
 * Possible duplicates: a property made by a student review that may be a
 * building already listed under another address.
 *
 * A report, not a tool. An exact address match is handled when the review is
 * submitted; these are the pairs a rule cannot settle (neighbouring numbers,
 * a building named in the review), so a person looks and decides. "Not a
 * duplicate" hides a pair in this browser only: there is nothing to store
 * about a pair that needs no action.
 */

const DISMISSED_KEY = "admin.reviewDuplicates.dismissed";
const REASON_COLOR = { "same address": "red", "review names this building": "amber", "same street, next door": "gray" };

function readDismissed() {
  try {
    return new Set(JSON.parse(window.localStorage.getItem(DISMISSED_KEY) || "[]"));
  } catch {
    return new Set();
  }
}

// `standalone` is the panel on its own page (Listings > Possible duplicates): it starts open.
export default function ReviewDuplicatesPanel({ dbTarget, standalone = false }) {
  const [suspects, setSuspects] = useState(null);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(standalone);
  const [dismissed, setDismissed] = useState(new Set());
  const [showDismissed, setShowDismissed] = useState(false);

  useEffect(() => {
    setDismissed(readDismissed());
  }, []);

  useEffect(() => {
    let cancelled = false;
    setSuspects(null);
    setError(null);
    adminFetch("/api/admin/review-duplicates", dbTarget)
      .then((rows) => !cancelled && setSuspects(Array.isArray(rows) ? rows : []))
      .catch((err) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [dbTarget]);

  function setDismissedFor(key, hide) {
    setDismissed((prev) => {
      const next = new Set(prev);
      if (hide) next.add(key);
      else next.delete(key);
      try {
        window.localStorage.setItem(DISMISSED_KEY, JSON.stringify([...next]));
      } catch {
        // Private browsing: the choice lasts for this visit only.
      }
      return next;
    });
  }

  const all = suspects ?? [];
  const active = all.filter((s) => !dismissed.has(s.key));
  const shown = showDismissed ? all : active;
  const hiddenCount = all.length - active.length;

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-4 py-2.5 text-left"
      >
        <span className="text-sm font-medium text-gray-900">Possible duplicates</span>
        {suspects === null && !error && <span className="text-[11px] text-gray-400">checking…</span>}
        {error && <span className="text-[11px] text-red-600">could not load</span>}
        {suspects !== null &&
          (active.length > 0 ? (
            <Badge color="amber">{active.length} to look at</Badge>
          ) : (
            <span className="text-[11px] text-gray-400">none</span>
          ))}
        <span className="ml-auto text-[11px] text-gray-400">{open ? "hide" : "show"}</span>
      </button>

      {open && (
        <div className="border-t border-gray-100 px-4 py-3 space-y-2">
          <p className="text-[11px] text-gray-500">
            A property made by a review, beside a listing that may be the same building. Nothing is merged
            from here.
          </p>
          {error && <p className="text-xs text-red-600">{error}</p>}
          {suspects !== null && shown.length === 0 && (
            <p className="text-xs text-gray-400">Nothing to look at.</p>
          )}
          {shown.map((s) => {
            const isDismissed = dismissed.has(s.key);
            return (
              <div
                key={s.key}
                className={`rounded-lg border border-gray-200 px-3 py-2 text-xs ${isDismissed ? "opacity-50" : ""}`}
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge color={REASON_COLOR[s.reason] || "gray"}>{s.reason}</Badge>
                  {s.meters != null && <span className="text-gray-400">{s.meters} m apart</span>}
                  <button
                    type="button"
                    onClick={() => setDismissedFor(s.key, !isDismissed)}
                    className="ml-auto text-gray-500 hover:text-gray-800 underline"
                  >
                    {isDismissed ? "Show again" : "Not a duplicate"}
                  </button>
                </div>
                <div className="mt-1.5 grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div className="min-w-0">
                    <p className="text-[11px] text-gray-400">From a review</p>
                    <a
                      href={`/listings/${s.stub.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-gray-900 hover:underline break-words"
                    >
                      {s.stub.address}
                    </a>
                    <p className="text-gray-500">
                      {s.stub.reviewCount} {s.stub.reviewCount === 1 ? "review" : "reviews"}
                      {s.stub.landlordNames.length > 0 && ` · names ${s.stub.landlordNames.join(", ")}`}
                    </p>
                  </div>
                  <div className="min-w-0">
                    <p className="text-[11px] text-gray-400">Listing{s.listing.live ? "" : " (draft)"}</p>
                    <a
                      href={`/listings/${s.listing.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-gray-900 hover:underline break-words"
                    >
                      {s.listing.title || s.listing.address}
                    </a>
                    {s.listing.title && <p className="text-gray-500 break-words">{s.listing.address}</p>}
                  </div>
                </div>
              </div>
            );
          })}
          {hiddenCount > 0 && (
            <button
              type="button"
              onClick={() => setShowDismissed((v) => !v)}
              className="text-[11px] text-gray-500 hover:text-gray-800 underline"
            >
              {showDismissed ? "Hide" : "Show"} {hiddenCount} marked not a duplicate
            </button>
          )}
        </div>
      )}
    </div>
  );
}
