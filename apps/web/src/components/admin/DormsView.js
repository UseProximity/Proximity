"use client";

import { useState } from "react";
import { fmtDate, prodConfirm, deleteRow, Stars, Badge, GearButton, TrashButton } from "@/components/admin/adminShared";

export default function DormsView({ data, search, dbTarget, isProd, isReadOnly, onOpenGear, onRefresh }) {
  const [expanded, setExpanded] = useState(new Set());

  const dorms = data || [];
  const q = search.trim().toLowerCase();
  const filtered = q ? dorms.filter((d) => (d.name || "").toLowerCase().includes(q)) : dorms;

  function toggleExpand(id) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function handleDeleteReview(id) {
    if (!confirm("Delete this dorm review? This cannot be undone.")) return;
    if (!prodConfirm(isProd, "Permanently delete this dorm review.")) return;
    try {
      await deleteRow("dorm_reviews", id, dbTarget);
      onRefresh();
    } catch (err) {
      alert(`Delete failed: ${err.message}`);
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-gray-500">{filtered.length} of {dorms.length} dorms</p>

      {filtered.map((d) => {
        const isOpen = expanded.has(d.id);
        const reviews = (d.dorm_reviews || []).filter((r) => !r.deleted_at);
        const avg = reviews.length ? reviews.reduce((s, r) => s + Number(r.rating || 0), 0) / reviews.length : null;
        const roomTypes = (d.dorm_room_types || []).map((rt) => rt.room_type);

        return (
          <div key={d.id} className={`rounded-xl border bg-white shadow-sm ${d.deleted_at ? "border-red-200" : "border-gray-200"}`}>
            <div className="flex items-center gap-3 px-4 py-2.5 cursor-pointer select-none" onClick={() => toggleExpand(d.id)}>
              <svg className={`w-4 h-4 text-gray-400 transition-transform flex-shrink-0 ${isOpen ? "rotate-90" : ""}`} viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
              </svg>
              {d.image ? (
                <img src={`/_next/image?url=${encodeURIComponent(d.image)}&w=96&q=15`} alt="" className="w-12 h-9 object-cover rounded border border-gray-200 flex-shrink-0" onError={(e) => { e.target.style.visibility = "hidden"; }} />
              ) : (
                <div className="w-12 h-9 rounded bg-gray-100 border border-gray-200 flex-shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{d.name}</p>
                <p className="text-[11px] text-gray-400 truncate">
                  {reviews.length} review{reviews.length !== 1 ? "s" : ""}
                  {avg != null && ` · ${avg.toFixed(1)}★`}
                </p>
              </div>
              {d.deleted_at && <Badge color="red">deleted</Badge>}
              <span onClick={(e) => e.stopPropagation()}>
                <GearButton onClick={() => onOpenGear("dorms", d)} />
              </span>
            </div>

            {isOpen && (
              <div className="px-4 pb-4 pt-1 space-y-3 border-t border-gray-100 bg-gray-50/60">
                {roomTypes.length > 0 && (
                  <div>
                    <h4 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Room types</h4>
                    <div className="flex flex-wrap gap-1">
                      {roomTypes.map((rt) => (
                        <span key={rt} className="px-2 py-0.5 text-[11px] bg-white border border-gray-200 rounded-full text-gray-600">{rt}</span>
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <h4 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Reviews ({reviews.length})</h4>
                  {reviews.length === 0 && <p className="text-xs text-gray-400 italic">No reviews</p>}
                  <div className="space-y-1.5">
                    {reviews.map((r) => {
                      const tags = (r.dorm_review_tags || []).map((t) => t.tags?.name).filter(Boolean);
                      return (
                        <div key={r.id} className="flex items-start gap-2 px-3 py-1.5 rounded-lg border border-gray-200 bg-white">
                          <Stars rating={r.rating} />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-gray-800 line-clamp-2">{r.content}</p>
                            <p className="text-[10px] text-gray-400">
                              {r.reviewer_name || "Anonymous"} · class of {r.class_year || "?"} · {r.dorm_type || "unknown room"} · {fmtDate(r.created_at)}
                            </p>
                            {tags.length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-0.5">
                                {tags.map((t) => <Badge key={t}>{t}</Badge>)}
                              </div>
                            )}
                          </div>
                          {!isReadOnly && <TrashButton title="Delete review" onClick={() => handleDeleteReview(r.id)} />}
                          <GearButton onClick={() => onOpenGear("dorm_reviews", r)} />
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {filtered.length === 0 && <p className="py-10 text-center text-sm text-gray-400">No dorms match.</p>}
    </div>
  );
}
