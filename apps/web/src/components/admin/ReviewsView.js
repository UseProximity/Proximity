"use client";

import { useState } from "react";
import {
  fmtDate,
  shortId,
  prodConfirm,
  deleteRow,
  sortByDate,
  SortToggle,
  SORT_NEWEST,
  Stars,
  Badge,
  InlineToggle,
  GearButton,
  TrashButton,
} from "@/components/admin/adminShared";

/*
 * Every property review in one table.
 *
 * Reviews already existed in the dashboard, but only nested: inside the listing
 * they were left on, and inside the person who wrote them. That answers what a
 * property has, and never what just arrived, which is where moderation starts,
 * and the reason an unverified review could sit for days behind a listing
 * nobody had a reason to expand.
 *
 * Verification is staged like every other edit here rather than written on
 * click: the legitimacy checkbox goes into the pending store and lands with
 * "Save Changes", so a mis-click on the production database is something the
 * admin can still discard.
 */

const FILTERS = [
  { key: "all", label: "all" },
  { key: "unverified", label: "unverified" },
  { key: "verified", label: "verified" },
  { key: "deleted", label: "deleted" },
];

function matchesFilter(r, filter) {
  if (filter === "unverified") return !r.legitimacy && !r.deleted_at;
  if (filter === "verified") return !!r.legitimacy && !r.deleted_at;
  if (filter === "deleted") return !!r.deleted_at;
  return true;
}

// Who the review is FROM, as the table should name them. A signed-in reviewer
// is the joined user; the rest carry only what the form collected, which is why
// `name` and `reviewer_email` exist as columns at all. Anonymous is a display
// choice the reviewer made, not a missing author, so the admin still sees who
// it was and the badge says it is hidden publicly.
function authorLabel(r) {
  return (
    r.reviewer?.name ||
    r.name ||
    r.reviewer?.email ||
    r.reviewer_email ||
    "unknown reviewer"
  );
}

export default function ReviewsView({
  data,
  search,
  dbTarget,
  isProd,
  isReadOnly,
  onOpenGear,
  onRefresh,
}) {
  const [expanded, setExpanded] = useState(new Set());
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState(SORT_NEWEST);

  const reviews = data || [];
  const q = search.trim().toLowerCase();

  const filtered = sortByDate(
    reviews.filter((r) => {
      if (!matchesFilter(r, filter)) return false;
      if (!q) return true;
      return [
        r.comment,
        authorLabel(r),
        r.reviewer?.email,
        r.reviewer_email,
        r.listings?.title,
        r.listings?.address,
        r.landlord_name,
        r.id,
      ].some((v) => (v || "").toLowerCase().includes(q));
    }),
    sort
  );

  const pendingCount = reviews.filter((r) => !r.legitimacy && !r.deleted_at).length;

  function toggleExpand(id) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleDelete(r) {
    if (!confirm("Permanently delete this review? This cannot be undone.\n\nTo take it down reversibly, set deleted_at from the gear menu instead."))
      return;
    if (!prodConfirm(isProd, "Permanently delete this review.")) return;
    try {
      await deleteRow("listing_reviews", r.id, dbTarget);
      onRefresh();
    } catch (err) {
      alert(`Delete failed: ${err.message}`);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <p className="text-xs text-gray-500">
          {filtered.length} of {reviews.length} reviews
          {pendingCount > 0 && (
            <span className="text-amber-600 font-medium"> · {pendingCount} awaiting verification</span>
          )}
        </p>
        <div className="ml-auto flex items-center gap-3 flex-wrap">
          <SortToggle value={sort} onChange={setSort} />
          <div className="flex items-center gap-1">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                className={`px-2 py-0.5 text-[11px] rounded-full border ${
                  filter === f.key
                    ? "bg-gray-800 border-gray-800 text-white"
                    : "bg-white border-gray-200 text-gray-500 hover:border-gray-300"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {filtered.map((r) => {
        const isOpen = expanded.has(r.id);
        const listing = r.listings;

        return (
          <div
            key={r.id}
            className={`rounded-xl border bg-white shadow-sm ${
              r.deleted_at ? "border-red-200" : !r.legitimacy ? "border-amber-200" : "border-gray-200"
            }`}
          >
            <div
              className="flex items-center gap-3 px-4 py-2.5 cursor-pointer select-none"
              onClick={() => toggleExpand(r.id)}
            >
              <svg
                className={`w-4 h-4 text-gray-400 transition-transform flex-shrink-0 ${isOpen ? "rotate-90" : ""}`}
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z"
                  clipRule="evenodd"
                />
              </svg>
              <Stars rating={r.rating} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">
                  {listing?.title || listing?.address || (
                    <span className="italic text-gray-400">(listing missing)</span>
                  )}
                </p>
                <p className="text-[11px] text-gray-400 truncate">
                  {authorLabel(r)}
                  {r.comment ? ` · ${r.comment}` : ""}
                </p>
              </div>
              {r.anonymous && <Badge title="Shown to students without a name">anonymous</Badge>}
              {r.source && <Badge color="blue" title="How this review reached us">{r.source}</Badge>}
              {!r.legitimacy && !r.deleted_at && <Badge color="amber">unverified</Badge>}
              {r.deleted_at && <Badge color="red">deleted</Badge>}
              <span className="hidden sm:block text-[11px] text-gray-400 whitespace-nowrap">
                {fmtDate(r.created_at)}
              </span>
              <span onClick={(e) => e.stopPropagation()} className="flex items-center gap-1">
                {!isReadOnly && <TrashButton title="Delete review" onClick={() => handleDelete(r)} />}
                <GearButton onClick={() => onOpenGear("listing_reviews", r)} />
              </span>
            </div>

            {isOpen && (
              <div className="px-4 pb-4 pt-1 space-y-3 border-t border-gray-100 bg-gray-50/60">
                {r.comment && <p className="text-xs text-gray-700 whitespace-pre-wrap">{r.comment}</p>}

                <div className="grid sm:grid-cols-3 gap-x-4 gap-y-1 text-xs text-gray-600">
                  <p><span className="text-gray-400">Overall:</span> {r.rating ?? "—"}</p>
                  <p><span className="text-gray-400">Communication:</span> {r.communication_rating ?? "—"}</p>
                  <p><span className="text-gray-400">Location:</span> {r.location_rating ?? "—"}</p>
                  <p><span className="text-gray-400">Value:</span> {r.value_rating ?? "—"}</p>
                  <p><span className="text-gray-400">Unit:</span> {[r.unit_designator, r.unit_number].filter(Boolean).join(" ") || "—"}</p>
                  <p><span className="text-gray-400">Reviewer email:</span> {r.reviewer?.email || r.reviewer_email || "—"}</p>
                  <p><span className="text-gray-400">Account:</span> {r.user_id ? shortId(r.user_id) : "not signed in"}</p>
                  <p><span className="text-gray-400">Confirmation sent:</span> {r.confirmation_sent_at ? fmtDate(r.confirmation_sent_at) : "—"}</p>
                  <p className="font-mono text-gray-400">{shortId(r.id)}</p>
                </div>

                {(r.landlord_name || r.landlord_email || r.landlord_phone || r.no_landlord_contact) && (
                  <div>
                    <h4 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1">
                      Landlord as reported by the reviewer
                    </h4>
                    <p className="text-xs text-gray-600">
                      {r.no_landlord_contact
                        ? "Reviewer had no landlord contact to give"
                        : [r.landlord_name, r.landlord_email, r.landlord_phone].filter(Boolean).join(" · ") || "—"}
                    </p>
                  </div>
                )}

                <div className="flex items-center gap-4 pt-1">
                  <InlineToggle
                    table="listing_reviews"
                    id={r.id}
                    field="legitimacy"
                    value={r.legitimacy}
                    disabled={isReadOnly || !!r.deleted_at}
                    label="Verified (counts toward the listing's rating)"
                  />
                  <InlineToggle
                    table="listing_reviews"
                    id={r.id}
                    field="anonymous"
                    value={r.anonymous}
                    disabled={isReadOnly}
                    label="Anonymous"
                  />
                  {r.deleted_at && (
                    <span className="text-[11px] text-red-600">
                      Removed {fmtDate(r.deleted_at)}. Clear deleted_at from the gear menu to restore.
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}

      {filtered.length === 0 && (
        <p className="py-10 text-center text-sm text-gray-400">No reviews match.</p>
      )}
    </div>
  );
}
