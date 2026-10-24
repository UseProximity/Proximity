"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import toast from "react-hot-toast";
import { AlertCircle, Building2, Check, ExternalLink, Info, Loader2, RotateCw, X } from "lucide-react";
import EditorOverview from "@/components/listings/editor/EditorOverview";
import { PropertyPhotoRow } from "@/components/listings/editor/EditorImageRows";
import EditorContact from "@/components/listings/editor/EditorContact";
import EditorUnits from "@/components/listings/editor/EditorUnits";
import { DraftBadge, PublishButton } from "@/components/listings/editor/DraftControls";
import ImportGaps from "@/components/listings/editor/ImportGaps";
import BackToTop from "@/components/ui/BackToTop";
import useLeaveGuard, { sendWhileLeaving } from "@/lib/useLeaveGuard";

/*
 * The import workspace: one tab per property the landlord ticked.
 *
 * Each tab is a draft listing in the database, created the moment they
 * pressed Continue, being filled in by a background read. While the read runs
 * the tab shows its progress; when it finishes the tab becomes the same
 * editor the dashboard uses for any listing, so what they learn here is what
 * they use later. At the bottom of each tab: Publish, or keep it as a draft
 * (it is already one, and lives on the Drafts page).
 *
 * A property they already have on Proximity gets no draft. Its read is laid
 * over the live listing as proposed changes, applied only when they say so.
 *
 * Nothing here is kept in the browser. The batch id in the URL is enough to
 * come back to the same tabs after a reload, or tomorrow.
 */

const POLL_MS = 3000;
// How long queued jobs may sit with nothing moving before the workspace
// kicks the runner itself (the one that started with the batch may have died).
const KICK_AFTER_MS = 20000;

const ACTIVE = new Set(["queued", "running"]);

function StatusLine({ job }) {
  if (job.status === "queued") return <span className="text-gray-400">Waiting to read…</span>;
  if (job.status === "running")
    return (
      <span className="inline-flex items-center gap-1 text-gray-500">
        <Loader2 className="h-3 w-3 animate-spin" /> {job.step || "Reading your website…"}
      </span>
    );
  if (job.status === "failed")
    return (
      <span className="inline-flex items-center gap-1 text-red-600">
        <AlertCircle className="h-3 w-3" /> Couldn&apos;t read it
      </span>
    );
  if (job.status === "cancelled") return <span className="text-gray-400">{job.target?.alreadyListed && job.target?.skipped ? "Not read: not yours to change" : job.step || "Skipped"}</span>;
  if (job.listing && !job.listing.isDraft && job.result?.mode === "sync")
    return <span className="text-amber-700">{job.result.held ? `${job.result.held} proposed change${job.result.held === 1 ? "" : "s"}` : "Up to date"}</span>;
  if (job.listing && !job.listing.isDraft)
    return (
      <span className="inline-flex items-center gap-1 text-green-700">
        <Check className="h-3 w-3" /> Published
      </span>
    );
  const s = job.result?.summary;
  if (!s) return <span className="text-gray-500">Ready to check</span>;
  return (
    <span className="text-gray-500">
      {s.units} {s.units === 1 ? "unit" : "units"} · {s.offers} {s.offers === 1 ? "lease" : "leases"}
      {s.photos ? ` · ${s.photos} photos` : ""}
    </span>
  );
}

function Progress({ job, others = 0 }) {
  const pct = Math.max(3, Math.min(100, job.progress ?? 0));
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-gray-200 bg-white p-12 text-center">
      <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      <p className="text-sm text-gray-700">
        {job.status === "queued" ? "Waiting to read" : job.step || "Reading"} {job.target?.name}…
      </p>
      <div className="h-1.5 w-64 overflow-hidden rounded-full bg-gray-100">
        <div className="h-full rounded-full bg-red-500 transition-all duration-700" style={{ width: `${pct}%` }} />
      </div>
      <p className="text-xs text-gray-400">Usually a minute or two.{others > 0 ? " You can check the finished ones meanwhile." : ""}</p>
    </div>
  );
}

function describe(e) {
  const where = e.detail?.label ? `${e.detail.label}: ` : "";
  const money = (n) => (n == null ? "no price" : `$${Number(n).toLocaleString("en-US")}`);
  switch (e.kind) {
    case "lease_new":
      return `${where}add a lease at ${money(e.new_value?.rent)}${e.new_value?.rentIsPerPerson ? " per person" : ""}${(e.new_value?.leaseTermMonths ?? []).length ? ` (${e.new_value.leaseTermMonths.join(", ")} months)` : ""}`;
    case "lease_withdrawn":
      return `${where}mark the ${money(e.detail?.rent)} lease unavailable (no longer on your website)`;
    case "lease_updated":
      return `${where}update lease details (${e.field})`;
    case "unit_relisted":
      return `${where}put the lease back on the market`;
    case "unit_new":
      return `${where}add this floor plan from your website${e.new_value?.offers ? `, ${e.new_value.offers} price${e.new_value.offers === 1 ? "" : "s"}` : ""}`;
    case "unit_updated":
      return `${where}fill in ${e.field}`;
    case "spec_mismatch":
      return `${where}your website says ${Object.entries(e.new_value ?? {}).map(([k, v]) => `${k} ${v}`).join(", ")} (Proximity has ${Object.entries(e.old_value ?? {}).map(([k, v]) => `${k} ${v}`).join(", ")})`;
    case "missing_unit":
      return `${where}is on Proximity but not on your website`;
    case "property_updated":
      return "fill in property details from your website";
    case "photos_added":
      return `${where}add ${e.new_value} photo${e.new_value === 1 ? "" : "s"}`;
    case "low_confidence":
      return "The website was hard to read, so nothing on this listing was changed automatically";
    case "churn_hold":
      return "More than a fifth of the leases would change at once, so nothing was changed automatically";
    default:
      return `${where}${e.kind}`;
  }
}

/* An existing listing's tab: the read as proposed changes, then the editor. */
function Proposed({ listingId, proposed, flagged, onApplied, claimed = false }) {
  const [picked, setPicked] = useState(() => new Set(proposed.map((e) => e.id)));
  const [busy, setBusy] = useState(false);
  const toggle = (id) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const send = async (apply, reject) => {
    setBusy(true);
    try {
      const res = await fetch("/api/landlord/import/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listingId, apply, reject }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return toast.error(data.error || "Couldn't apply those changes.");
      const failed = (data.results ?? []).filter((r) => !r.ok).length;
      if (failed) toast.error(`${failed} change${failed === 1 ? "" : "s"} couldn't be applied.`);
      else if (apply.length) toast.success(`${apply.length} change${apply.length === 1 ? "" : "s"} applied.`);
      await onApplied();
    } catch {
      toast.error("Network error.");
    } finally {
      setBusy(false);
    }
  };
  if (!proposed.length && !flagged.length) {
    return (
      <div className="mb-4 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
        Your website and this listing agree. Nothing to change.
      </div>
    );
  }
  return (
    <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50/60 p-4">
      <p className="text-sm font-semibold text-gray-900">What your website says differently</p>
      <p className="mt-0.5 text-xs text-gray-600">
        {claimed
          ? "This listing had no landlord, so it is yours now. Its description, your contact details and its photos were filled in from your website. Tick what else to apply."
          : "This listing is already on Proximity, so nothing changed yet. Tick what to apply."}
      </p>
      {proposed.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {proposed.map((e) => (
            <li key={e.id} className="flex items-start gap-2 text-sm text-gray-800">
              <input type="checkbox" checked={picked.has(e.id)} onChange={() => toggle(e.id)} className="mt-1 accent-red-600" />
              <span>{describe(e)}</span>
            </li>
          ))}
        </ul>
      )}
      {flagged.length > 0 && (
        <ul className="mt-3 space-y-1 border-t border-amber-200 pt-3 text-sm text-amber-800">
          {flagged.map((e) => (
            <li key={e.id}>{describe(e)}. Left as it is; change it below if you want.</li>
          ))}
        </ul>
      )}
      {proposed.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy || !picked.size}
            onClick={() => send([...picked], proposed.filter((e) => !picked.has(e.id)).map((e) => e.id))}
            className="rounded-lg bg-red-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
          >
            {busy ? "Applying…" : `Apply ${picked.size} change${picked.size === 1 ? "" : "s"}`}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => send([], proposed.map((e) => e.id))}
            className="rounded-lg border border-gray-300 bg-white px-3.5 py-2 text-sm font-medium text-gray-700 hover:border-gray-400"
          >
            Dismiss all
          </button>
        </div>
      )}
    </div>
  );
}

/* One finished tab: the dashboard editor on the draft (or live listing). */
/*
 * What the read had to say for itself (plans left out, a fee the portal
 * adds, a stronger model used), behind an icon at the top right. Listing
 * them as a stack of banners buried the property under caveats; hover or
 * tap to read them, the rest of the time the count is enough.
 */
function ReadNotes({ notes }) {
  const [open, setOpen] = useState(false);
  if (!notes.length) return null;
  return (
    <div className="relative shrink-0" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        aria-expanded={open}
        aria-label={`${notes.length} note${notes.length === 1 ? "" : "s"} from reading your website`}
        className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100"
      >
        <Info className="h-3.5 w-3.5" />
        {notes.length} {notes.length === 1 ? "note" : "notes"}
      </button>
      {open && (
        <div role="tooltip" className="absolute right-0 top-full z-20 mt-1 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-gray-200 bg-white p-3 text-xs text-gray-700 shadow-lg">
          <p className="mb-2 font-semibold text-gray-900">From reading your website</p>
          <ul className="space-y-1.5">
            {notes.map((n, i) => (
              <li key={i} className="flex gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
                <span>{n}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ListingTab({ job, user, onPublished }) {
  const listingId = job.listing?.id;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    if (!listingId) return;
    try {
      const res = await fetch(`/api/landlord/import/listing/${listingId}`);
      if (!res.ok) throw new Error();
      setData(await res.json());
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [listingId]);
  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white p-12 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Opening {job.target?.name}…
      </div>
    );
  }
  if (!data?.listing) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-600">
        This listing could not be opened. It may have been removed.
      </div>
    );
  }
  const p = data.listing;
  const isPropertyOwner = p.ownership !== "lease";
  const notes = job.result?.notes ?? [];
  const needsAddress = !!job.target?.needsAddress;

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold text-gray-900">{p.title || p.address}</h2>
              {p.isDraft ? <DraftBadge /> : <span className="rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-semibold text-green-800">Live</span>}
              {job.result?.sourceUrl && (
                <a href={job.result.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-red-600">
                  <ExternalLink className="h-3 w-3" /> read from your website
                </a>
              )}
            </div>
            <p className="mt-0.5 text-sm text-gray-600">{p.address}</p>
          </div>
          <ReadNotes notes={notes} />
        </div>
        {needsAddress && (
          <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
            We couldn&apos;t place this address on the map. Check it is complete (street, city, state) before publishing.
          </p>
        )}
      </div>

      {p.isDraft && <ImportGaps listing={p} />}
      {!p.isDraft && <Proposed listingId={p._id || p.id} proposed={data.proposed ?? []} flagged={data.flagged ?? []} onApplied={load} claimed={!!job.target?.alreadyListed?.claimed} />}

      <EditorOverview listing={p} canEdit={isPropertyOwner} onChanged={load} />
      <PropertyPhotoRow listing={p} isPropertyOwner={isPropertyOwner} onChanged={load} />
      <EditorContact listing={p} onChanged={load} />
      <EditorUnits listing={p} isPropertyOwner={isPropertyOwner} currentUserEmail={user?.email} onChanged={load} />

      {p.isDraft && (
        <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 bg-gray-50/95 px-4 py-3 backdrop-blur">
          <p className="text-xs text-gray-600">
            This is a draft. Students can&apos;t see it until you publish. It stays on your Drafts page either way.
          </p>
          <div className="flex items-center gap-2">
            <Link href="/dashboard/landlord?tab=drafts" className="rounded-lg border border-gray-300 bg-white px-3.5 py-2 text-sm font-medium text-gray-700 hover:border-gray-400">
              Keep as draft
            </Link>
            <PublishButton kind="property" id={p._id || p.id} size="md" label="Publish" onPublished={async () => { await load(); await onPublished(); }} />
          </div>
        </div>
      )}
    </div>
  );
}

export default function ImportWorkspace({ user, batchId, onDone, onCancel }) {
  const [batch, setBatch] = useState(null);
  const [error, setError] = useState(null);
  const [activeId, setActiveId] = useState(null);
  const lastMovement = useRef(Date.now());
  const kicked = useRef(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/landlord/import/batches/${batchId}`);
      if (!res.ok) {
        setError(res.status === 404 ? "This import can't be found. It may belong to another account." : "Couldn't load this import.");
        return null;
      }
      const data = await res.json();
      setBatch((prev) => {
        const moved = JSON.stringify((prev?.jobs ?? []).map((j) => [j.status, j.step])) !== JSON.stringify(data.jobs.map((j) => [j.status, j.step]));
        if (moved) lastMovement.current = Date.now();
        return data;
      });
      setActiveId((cur) => cur ?? data.jobs.find((j) => j.status === "done")?.id ?? data.jobs[0]?.id ?? null);
      return data;
    } catch {
      setError("Network error.");
      return null;
    }
  }, [batchId]);

  useEffect(() => {
    load();
  }, [load]);

  // Poll while anything is still being read; nudge the runner if the queue
  // has sat still too long.
  useEffect(() => {
    if (!batch?.jobs.some((j) => ACTIVE.has(j.status))) return undefined;
    const t = setInterval(async () => {
      const data = await load();
      if (!data) return;
      const queued = data.jobs.some((j) => j.status === "queued");
      const running = data.jobs.some((j) => j.status === "running");
      if (queued && !running && !kicked.current && Date.now() - lastMovement.current > KICK_AFTER_MS) {
        kicked.current = true;
        fetch("/api/landlord/import/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ batchId }) }).catch(() => {});
        setTimeout(() => {
          kicked.current = false;
        }, 60000);
      }
    }, POLL_MS);
    return () => clearInterval(t);
  }, [batch, load, batchId]);

  /*
   * Leaving while properties are still being read: those are cancelled and
   * their empty drafts deleted, so nothing half-read sits on the Drafts page.
   * Finished ones are kept. The same applies to "Done for now".
   */
  const unfinished = batch?.jobs.filter((j) => ACTIVE.has(j.status)).length ?? 0;
  const LEAVE_MESSAGE = `${unfinished} ${unfinished === 1 ? "property hasn't" : "properties haven't"} been read yet. If you leave now ${unfinished === 1 ? "it" : "they"} will be deleted; the finished ones stay on your Drafts page. Leave anyway?`;
  const cancelUnfinished = ({ beacon }) => sendWhileLeaving(`/api/landlord/import/batches/${batchId}/cancel`, {}, { beacon });
  useLeaveGuard({ active: unfinished > 0, message: LEAVE_MESSAGE, onLeave: cancelUnfinished });
  const leave = async () => {
    if (unfinished > 0) {
      if (!window.confirm(LEAVE_MESSAGE)) return;
      await cancelUnfinished({ beacon: false });
    }
    onDone();
  };

  const retry = async (job) => {
    const res = await fetch(`/api/landlord/import/jobs/${job.id}`, { method: "POST" });
    if (!res.ok) toast.error("Couldn't retry that one.");
    await load();
  };
  const remove = async (job) => {
    if (!window.confirm(`Remove ${job.target?.name} from this import?${job.listing?.isDraft ? " Its draft will be deleted." : ""}`)) return;
    const res = await fetch(`/api/landlord/import/jobs/${job.id}`, { method: "DELETE" });
    if (!res.ok) return toast.error("Couldn't remove that one.");
    const data = await load();
    const rest = (data?.jobs ?? []).filter((j) => j.status !== "cancelled");
    if (!rest.length) onCancel();
    else if (activeId === job.id) setActiveId(rest[0].id);
  };

  if (error) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <p className="text-sm text-gray-700">{error}</p>
        <button type="button" onClick={onCancel} className="mt-4 text-sm font-medium text-red-600 hover:underline">
          Start a new import
        </button>
      </div>
    );
  }
  if (!batch) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    );
  }

  // Every ticked property has a tab, the ones already on Proximity included.
  const jobs = batch.jobs;
  const existing = jobs.filter((j) => j.target?.alreadyListed);
  const fresh = jobs.filter((j) => !j.target?.alreadyListed);
  const reading = jobs.filter((j) => ACTIVE.has(j.status)).length;
  const done = jobs.filter((j) => j.status === "done").length;
  const published = jobs.filter((j) => j.status === "done" && j.listing && !j.listing.isDraft && j.result?.mode === "import").length;
  let host = "your website";
  try {
    host = new URL(batch.pastedUrl).hostname.replace(/^www\./, "");
  } catch {
    /* keep fallback */
  }
  const nameOf = (j) => j.listing?.title || j.target?.name || j.target?.address || "Property";

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-6">
      <BackToTop />
      <div className="sticky top-[83px] z-40 -mx-4 mb-5 border-b border-gray-200 bg-gray-50/95 px-4 pb-4 pt-5 backdrop-blur md:top-[104px]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight text-gray-900">Review your listings</h1>
            <p className="mt-1 text-sm text-gray-500">
              {fresh.length > 0 && `${fresh.length} new ${fresh.length === 1 ? "property" : "properties"} from ${host}, saved as drafts. Check each one, then publish it or keep it as a draft.`}
              {fresh.length > 0 && existing.length > 0 && " "}
              {existing.length > 0 && `${existing.length} ${existing.length === 1 ? "is" : "are"} already on Proximity: ${existing.length === 1 ? "its tab shows" : "their tabs show"} what the website says differently.`}
            </p>
            {reading > 0 && jobs.length > 1 && (
              <p className="mt-1 text-xs text-gray-500">
                Reading {reading} {reading === jobs.length ? "" : "more "}from your website, one at a time.
                {done > 0 ? " You can check the finished ones meanwhile." : ""}
              </p>
            )}
          </div>
          <div className="flex flex-col items-end gap-1">
            <button
              type="button"
              onClick={leave}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-gray-800"
            >
              Done for now
            </button>
            <p className="text-[11px] text-gray-500">
              {published ? `${published} published, ` : ""}{done - published} draft{done - published === 1 ? "" : "s"} on your Drafts page
            </p>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-4 md:flex-row md:items-start">
        <nav className="flex gap-2 overflow-x-auto pb-1 md:w-64 md:shrink-0 md:flex-col md:overflow-visible md:pb-0">
          {[
            { title: "New from your website", list: fresh },
            { title: "Already on Proximity", list: existing },
          ].filter((g) => g.list.length).map((g, gi) => (
          <div key={g.title} className="contents md:block">
            {(fresh.length > 0 && existing.length > 0) && (
              <p className={`hidden text-[11px] font-semibold uppercase tracking-wide text-gray-400 md:block ${gi ? "mt-4 border-t border-gray-200 pt-3" : ""} mb-1.5`}>
                {g.title} ({g.list.length})
              </p>
            )}
          {g.list.map((j) => {
            const active = j.id === activeId;
            return (
              <div
                key={j.id}
                className={`group relative flex min-w-[12rem] items-start rounded-lg border text-left transition-colors md:min-w-0 ${
                  active ? "border-red-500 bg-red-50" : "border-gray-200 bg-white hover:border-red-300"
                }`}
              >
                <button type="button" onClick={() => setActiveId(j.id)} className="min-w-0 flex-1 px-3 py-2.5 text-left">
                  <span className="block truncate pr-4 text-sm font-medium text-gray-900">{nameOf(j)}</span>
                  {j.target?.alreadyListed && (
                    <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-700">
                      <Building2 className="h-3 w-3" />
                      {j.target.alreadyListed.claimed ? "Now yours" : j.target.alreadyListed.mine ? "Yours" : "Another landlord's"}
                    </span>
                  )}
                  <span className="mt-1 block text-[11px]">
                    <StatusLine job={j} />
                  </span>
                </button>
                {j.status !== "running" && (
                  <button
                    type="button"
                    onClick={() => remove(j)}
                    aria-label={`Remove ${nameOf(j)} from this import`}
                    className="absolute right-1.5 top-1.5 rounded p-0.5 text-gray-300 opacity-0 transition hover:text-red-600 group-hover:opacity-100"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            );
          })}
          </div>
          ))}
        </nav>

        <div className="min-w-0 flex-1">
          {jobs.map((j) => (
            <div key={j.id} className={j.id === activeId ? "" : "hidden"}>
              {ACTIVE.has(j.status) && <Progress job={j} others={jobs.length - 1} />}
              {j.status === "cancelled" && (
                <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-600">
                  <Building2 className="mx-auto mb-2 h-6 w-6 text-gray-400" />
                  <p className="font-medium text-gray-900">{nameOf(j)}</p>
                  <p className="mt-1">{j.target?.skipped || "Skipped."}</p>
                  {j.target?.alreadyListed && !j.target.alreadyListed.mine && (
                    <p className="mt-2 text-xs text-gray-500">
                      Another landlord lists this building, so its listing was not read or changed. If you let units here too, add them to it from{" "}
                      <Link href="/add-listing?mode=manual" className="font-medium text-red-600 hover:underline">
                        Type it in myself
                      </Link>
                      , or contact us to share the building.
                    </p>
                  )}
                </div>
              )}
              {j.status === "failed" && (
                <div className="rounded-xl border border-gray-200 bg-white p-8 text-center">
                  <AlertCircle className="mx-auto h-6 w-6 text-red-500" />
                  <p className="mt-2 text-sm font-medium text-gray-900">{nameOf(j)}</p>
                  <p className="mt-1 text-sm text-gray-600">{j.error}</p>
                  <div className="mt-4 flex justify-center gap-3">
                    <button
                      type="button"
                      onClick={() => retry(j)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:border-red-300"
                    >
                      <RotateCw className="h-4 w-4" /> Try again
                    </button>
                    {j.listing && (
                      <button
                        type="button"
                        onClick={() => setBatch((b) => ({ ...b, jobs: b.jobs.map((x) => (x.id === j.id ? { ...x, status: "done", result: { mode: "import", notes: ["We couldn't read this one from your website, so it starts blank."] } } : x)) }))}
                        className="rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700"
                      >
                        Fill it in by hand
                      </button>
                    )}
                  </div>
                </div>
              )}
              {j.status === "done" && j.listing && (
                <ListingTab job={j} user={user} onPublished={load} />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
