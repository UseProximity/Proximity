"use client";

/*
 * Admin Home (Wyatt, 2026-11-12): the first page the team sees. What needs
 * attention right now, each count opening the page where it is handled; the
 * follow-ups the team set for itself in notes; and the week in five numbers.
 */
import { useEffect, useState } from "react";
import { adminFetch } from "@/components/admin/adminShared";
import { AdminLink } from "@/components/admin/RecordLink";
import { listingPath, personPath } from "@/components/admin/adminNav";

const dateLabel = (d) => new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

function QueueCard({ item }) {
  const unknown = item.count == null;
  const clear = item.count === 0;
  return (
    <AdminLink
      path={item.path}
      params={item.params ?? undefined}
      title={item.hint}
      className={`block rounded-xl border p-3 transition-colors ${clear || unknown ? "border-gray-200 bg-white hover:border-gray-300" : "border-amber-300 bg-amber-50 hover:border-amber-400"}`}
    >
      <span className={`block text-2xl font-semibold ${clear || unknown ? "text-gray-300" : "text-gray-900"}`}>{unknown ? "?" : item.count}</span>
      <span className={`block text-sm ${clear || unknown ? "text-gray-500" : "font-medium text-gray-900"}`}>{item.label}</span>
      <span className="mt-0.5 block text-[11px] leading-snug text-gray-500">{unknown ? "Could not be counted on this database." : item.hint}</span>
    </AdminLink>
  );
}

export default function HomeView({ dbTarget }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    adminFetch("/api/admin/home", dbTarget)
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setError(e.message));
    return () => { cancelled = true; };
  }, [dbTarget]);

  if (error) return <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  if (!data) return <div className="py-20 text-center text-sm text-gray-400">Loading...</div>;

  const waiting = data.queues.filter((x) => x.count > 0);
  const clear = data.queues.filter((x) => !(x.count > 0));
  const due = data.followUps.rows.filter((f) => f.due);
  const upcoming = data.followUps.rows.filter((f) => !f.due);

  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-lg font-semibold text-gray-900">Needs attention</h2>
        <p className="mb-3 text-sm text-gray-500">
          {waiting.length === 0 ? "Nothing is waiting on the team." : `${waiting.length} thing${waiting.length === 1 ? "" : "s"} waiting on the team. Click one to go handle it.`}
        </p>
        {waiting.length > 0 && <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{waiting.map((x) => <QueueCard key={x.key} item={x} />)}</div>}
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-gray-900">Follow-ups from notes</h3>
        {data.followUps.unavailable ? (
          <p className="text-sm text-gray-500">Notes are not set up on this database yet.</p>
        ) : data.followUps.rows.length === 0 ? (
          <p className="text-sm text-gray-500">No follow-ups due or coming up in the next week.</p>
        ) : (
          <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
            {[...due, ...upcoming].map((f) => (
              <li key={f.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3 py-2 text-sm">
                <span className={`w-28 flex-shrink-0 text-xs font-semibold ${f.due ? "text-red-700" : "text-gray-500"}`}>{f.due ? "Due " : ""}{dateLabel(f.on)}</span>
                <AdminLink path={f.kind === "user" ? personPath(f.subjectId) : listingPath(f.subjectId)}>{f.subject}</AdminLink>
                <span className="min-w-0 flex-1 truncate text-gray-600">{f.body}</span>
                <span className="text-[11px] text-gray-400">{f.author}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-gray-900">The last 7 days</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {data.pulse.map((p) => (
            <div key={p.label} className="rounded-xl border border-gray-200 bg-white p-3">
              <div className="text-xl font-semibold text-gray-900">{p.count ?? "?"}</div>
              <div className="text-xs text-gray-500">{p.label}</div>
            </div>
          ))}
        </div>
      </section>

      {clear.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold text-gray-900">All clear</h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{clear.map((x) => <QueueCard key={x.key} item={x} />)}</div>
        </section>
      )}
    </div>
  );
}
