"use client";

/*
 * The landlord's Apply numbers at this property, under their contact block
 * where the application link is set.
 *
 * Two tiles (Wyatt, 2026-11-15): "Clicked apply" (how many students opened
 * the landlord's application from the Apply button) and "Confirmed applied"
 * (those who then told us they submitted it). Only the second names anyone
 * and opens a list (Wyatt, 2026-11-16): a click alone stays anonymous.
 * Hidden until there is a link or a click.
 */
import { useEffect, useState } from "react";
import { Pen } from "lucide-react";

const dateLabel = (iso) =>
  iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";

const Count = ({ data, value }) =>
  data ? <span className="text-base font-bold">{value ?? 0}</span> : <span className="inline-block h-5 w-6 animate-pulse rounded bg-gray-200" />;

export default function EditorApplications({ listing, viewAsId = null }) {
  const listingId = listing?._id || listing?.id;
  const hasLink = (listing?.myLeases ?? []).some((l) => l.applicationUrl);
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(false);

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
  const people = data?.applicants ?? [];

  return (
    <div className="rounded-xl bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <Pen className="h-4 w-4 text-red-600" />
        <h3 className="text-sm font-semibold text-gray-900">Applications</h3>
      </div>
      <p className="mt-0.5 text-xs text-gray-500">
        From the Apply button on your listing. Students apply on your own site, so &quot;confirmed&quot; is what they tell us.
        You see a student&apos;s name once they confirm.
      </p>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <div className="flex items-center justify-between gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm font-semibold text-gray-800">
          <span>Clicked apply</span>
          <Count data={data} value={data?.started} />
        </div>
        <button
          type="button"
          disabled={!data}
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2.5 text-left text-sm font-semibold transition-colors ${
            open ? "border-red-600 bg-red-50 text-red-700" : "border-gray-200 bg-gray-50 text-gray-800 hover:bg-gray-100"
          }`}
        >
          <span>Confirmed applied</span>
          <Count data={data} value={data?.applied} />
        </button>
      </div>
      {open && (
        people.length ? (
          <ul className="mt-3 divide-y divide-gray-100 border-t border-gray-100">
            {people.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium text-gray-900">{a.name || "A student"}</p>
                  {a.email && <p className="truncate text-xs text-gray-500">{a.email}</p>}
                </div>
                <span className="shrink-0 text-xs text-gray-400">Applied {dateLabel(a.at)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-xs text-gray-500">No one has confirmed they applied yet.</p>
        )
      )}
    </div>
  );
}
