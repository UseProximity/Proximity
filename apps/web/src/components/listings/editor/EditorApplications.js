"use client";

/*
 * The landlord's Apply numbers at this property, under their contact block
 * where the application link is set (Wyatt, 2026-11-14).
 *
 * "Went to apply" counts students who clicked Apply on their link; "Said they
 * applied" counts those who told us they submitted it. Only the second group
 * is named: a click is not an application, and identities stay screened
 * until a student has actually reached the landlord (see
 * lib/listings/applications.js). Hidden until there is a link or a number.
 */
import { useEffect, useState } from "react";
import { FileSignature } from "lucide-react";

const dateLabel = (iso) =>
  iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";

export default function EditorApplications({ listing, viewAsId = null }) {
  const listingId = listing?._id || listing?.id;
  const hasLink = (listing?.myLeases ?? []).some((l) => l.applicationUrl);
  const [data, setData] = useState(null);

  useEffect(() => {
    if (!listingId) return;
    let cancelled = false;
    const q = viewAsId ? `?viewAs=${encodeURIComponent(viewAsId)}` : "";
    fetch(`/api/landlord/listings/${listingId}/applications${q}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [listingId, viewAsId]);

  if (!hasLink && !data?.started) return null;
  // Until the numbers arrive, a pulse rather than a confident 0.
  const num = (n) => (data ? n ?? 0 : <span className="inline-block h-7 w-8 animate-pulse rounded bg-gray-200 align-middle" />);
  const started = num(data?.started);
  const applied = num(data?.applied);

  return (
    <div className="rounded-xl bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <FileSignature className="h-4 w-4 text-red-600" />
        <h3 className="text-sm font-semibold text-gray-900">Applications</h3>
      </div>
      <p className="mt-0.5 text-xs text-gray-500">
        From the Apply button on your listing. Students apply on your own site, so &quot;applied&quot; is what they tell us.
      </p>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <div className="rounded-lg bg-gray-50 px-3 py-2">
          <p className="text-2xl font-bold text-gray-900">{started}</p>
          <p className="text-xs text-gray-500">Went to apply</p>
        </div>
        <div className="rounded-lg bg-gray-50 px-3 py-2">
          <p className="text-2xl font-bold text-gray-900">{applied}</p>
          <p className="text-xs text-gray-500">Said they applied</p>
        </div>
      </div>
      {data?.applicants?.length > 0 && (
        <ul className="mt-3 divide-y divide-gray-100 border-t border-gray-100">
          {data.applicants.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <div className="min-w-0">
                <p className="truncate font-medium text-gray-900">{a.name || "A student"}</p>
                {a.email && <p className="truncate text-xs text-gray-500">{a.email}</p>}
              </div>
              <span className="shrink-0 text-xs text-gray-400">Applied {dateLabel(a.appliedAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
