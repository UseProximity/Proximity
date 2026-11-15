"use client";

/*
 * Reviews > Referrals: the ambassador leaderboard (who has driven how many
 * reviews, approved and pending) and how each one wants to be paid. The data
 * route already existed (/api/admin/referrals); this is its first screen.
 */
import { useEffect, useState } from "react";
import { adminFetch, fmtDate, Stars } from "@/components/admin/adminShared";
import { PersonLink } from "@/components/admin/RecordLink";

function Details({ id, dbTarget }) {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    adminFetch(`/api/admin/referrals?details=${id}`, dbTarget).then((d) => setRows(d.reviews ?? [])).catch(() => setRows([]));
  }, [id, dbTarget]);
  if (!rows) return <p className="px-3 py-2 text-xs text-gray-400">Loading...</p>;
  if (!rows.length) return <p className="px-3 py-2 text-xs text-gray-400">No reviews.</p>;
  return (
    <ul className="divide-y divide-gray-100 bg-gray-50">
      {rows.map((r) => (
        <li key={r.id} className="flex flex-wrap items-center gap-2 px-3 py-1.5 text-xs text-gray-700">
          <Stars rating={r.rating} />
          <span>{r.address}</span>
          <span className="text-gray-500">by {r.reviewerName}{r.reviewerEmail ? ` (${r.reviewerEmail})` : ""}</span>
          <span className="ml-auto text-gray-400">{fmtDate(r.date)}</span>
        </li>
      ))}
    </ul>
  );
}

export default function ReferralsView({ dbTarget, search = "" }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    adminFetch("/api/admin/referrals", dbTarget)
      .then((d) => !cancelled && setRows(d.leaderboard ?? d.results ?? d.ambassadors ?? []))
      .catch((e) => !cancelled && setError(e.message));
    return () => { cancelled = true; };
  }, [dbTarget]);

  if (error) return <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  if (!rows) return <div className="py-16 text-center text-sm text-gray-400">Loading...</div>;
  const q = search.trim().toLowerCase();
  const shown = rows.filter((r) => !q || `${r.name ?? ""} ${r.email ?? ""}`.toLowerCase().includes(q));

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Referrals</h2>
        <p className="text-sm text-gray-500">Ambassadors ranked by the reviews their link brought in. Approved reviews are the ones that count toward a payout.</p>
      </div>
      {shown.length === 0 ? (
        <p className="rounded-xl border border-dashed border-gray-300 bg-white py-10 text-center text-sm text-gray-400">No referred reviews yet.</p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          {shown.map((r, i) => (
            <div key={r.id} className="border-b border-gray-100 last:border-b-0">
              <div className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
                <span className="w-6 text-xs text-gray-400">{i + 1}</span>
                <span className="min-w-0 flex-1"><PersonLink id={r.id}>{r.name}</PersonLink>{r.email && <span className="ml-2 text-xs text-gray-500">{r.email}</span>}</span>
                <span className="text-xs text-gray-600">{r.approved} approved, {r.pending} pending</span>
                <span className="text-xs text-gray-500">{r.paymentMethod ? `${r.paymentMethod}: ${r.paymentHandle ?? "no handle"}` : "No payout details"}</span>
                <button type="button" onClick={() => setOpen(open === r.id ? null : r.id)} className="text-xs underline">{open === r.id ? "Hide reviews" : "Show reviews"}</button>
              </div>
              {open === r.id && <Details id={r.id} dbTarget={dbTarget} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
