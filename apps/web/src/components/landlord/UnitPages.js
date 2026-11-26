"use client";

/*
 * Agent tab, Sources: a page per unit (Wyatt, 2026-11-06). The building's
 * website stays where new units show up; a unit with its own page is read
 * from that page alone each day, and when the page is gone the unit is
 * treated as let and its leases are withdrawn.
 */
import { useState } from "react";
import toast from "react-hot-toast";
import { Pencil, Trash2 } from "lucide-react";

const STATUS = {
  ok: { text: "Read", className: "text-green-700" },
  gone: { text: "Page gone, leases withdrawn", className: "text-amber-700" },
  failed: { text: "Could not read last time", className: "text-red-600" },
};

async function send(method, url, body) {
  const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d?.error || "Something went wrong");
  return d;
}

function UnitPageRow({ listingId, row, owner, onChanged }) {
  const [editing, setEditing] = useState(false);
  const [url, setUrl] = useState(row.page?.url ?? "");
  const [busy, setBusy] = useState(false);
  const endpoint = `/api/landlord/listings/${listingId}/agent/unit-pages`;

  const save = async () => {
    if (!url.trim()) return;
    setBusy(true);
    try {
      await send("POST", endpoint, { unitId: row.unitId, url: url.trim() });
      toast.success("Saved. It is read with the next sync.");
      setEditing(false);
      onChanged();
    } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };
  const remove = async () => {
    setBusy(true);
    try {
      await send("DELETE", endpoint, { unitId: row.unitId });
      toast.success("Removed. This unit is read from the building page again.");
      setUrl("");
      onChanged();
    } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };

  const status = row.page?.status ? STATUS[row.page.status] : null;
  return (
    <li className="py-1.5">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-gray-800">{row.unit}</span>
        {owner && !editing && (
          <button type="button" onClick={() => setEditing(true)} className="text-gray-400 hover:text-gray-700" title={row.page ? "Change page" : "Add page"} aria-label={row.page ? `Change page for ${row.unit}` : `Add page for ${row.unit}`}>
            <Pencil className="h-3 w-3" />
          </button>
        )}
        {owner && row.page && !editing && (
          <button type="button" disabled={busy} onClick={remove} className="text-gray-400 hover:text-red-600 disabled:opacity-40" title="Remove page" aria-label={`Remove page for ${row.unit}`}>
            <Trash2 className="h-3 w-3" />
          </button>
        )}
      </div>
      {editing ? (
        <form onSubmit={(e) => { e.preventDefault(); save(); }} className="mt-1 space-y-1">
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://your-site.com/this-unit" className="w-full rounded-lg border border-gray-300 px-2 py-1 text-xs" />
          <div className="flex gap-2">
            <button type="submit" disabled={busy || !url.trim()} className="rounded-lg bg-gray-900 px-2 py-1 text-[11px] font-semibold text-white disabled:opacity-50">{busy ? "Saving..." : "Save"}</button>
            <button type="button" onClick={() => { setEditing(false); setUrl(row.page?.url ?? ""); }} className="text-[11px] text-gray-500">Cancel</button>
          </div>
        </form>
      ) : row.page ? (
        <>
          <a href={row.page.url} target="_blank" rel="noopener noreferrer" className="block truncate text-[11px] text-red-600 hover:underline" title={row.page.url}>{row.page.url.replace(/^https?:\/\/(www\.)?/, "")}</a>
          {status && <p className={`text-[11px] ${status.className}`}>{status.text}</p>}
        </>
      ) : (
        <p className="text-[11px] text-gray-400">From the building page</p>
      )}
    </li>
  );
}

export default function UnitPages({ listingId, unitPages, owner, onChanged }) {
  if (!unitPages?.length) return null;
  return (
    <div className="mt-3 border-t border-gray-100 pt-2">
      <p className="text-xs font-medium text-gray-900">Unit pages</p>
      <p className="text-[11px] text-gray-500">Give a unit its own page and it is read from there. If that page goes away, the unit&apos;s leases are withdrawn.</p>
      <ul className="mt-1 divide-y divide-gray-100">
        {unitPages.map((row) => (
          <UnitPageRow key={row.unitId} listingId={listingId} row={row} owner={owner} onChanged={onChanged} />
        ))}
      </ul>
    </div>
  );
}
