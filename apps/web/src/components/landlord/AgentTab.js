"use client";

/*
 * The Agent tab on a property's dashboard page (PRD v3; laid out by Wyatt,
 * 2026-10-27, round 6).
 *
 *   main      the listing's one chat (LandlordProxyChat): students'
 *             questions and tour requests, and the landlord's talk with the
 *             agent (tell it something new, change what students see, ask
 *             what it knows; every change is confirmed before it is saved)
 *   side      "+ Add source" (a file or a website) and the sources it reads
 *             from, with Sync now and how long a sync usually takes; a sync
 *             keeps running if the landlord leaves the page
 *   below     changes waiting on the landlord, what the agent knows (each
 *             fact with the exact page or document it came from, and a menu
 *             to edit or delete it), and the change history
 *
 * Drafts have an agent too; Proxy answers students once the listing is
 * published. Every write goes through the agent routes, which check
 * ownership.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { RefreshCw, Link2, Upload, History, ChevronDown, ChevronRight, CheckCircle2, XCircle, Plus, MoreHorizontal, FileText, Globe } from "lucide-react";
import LandlordProxyChat from "@/components/landlord/LandlordProxyChat";
import ChatSkeleton from "@/components/chat/ChatSkeleton";

const when = (iso) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "");
const SECTION_LABELS = { fees: "Fees", policies: "Policies", specials: "Specials and promotions", misc: "Other details", core: "Displayed fields set by you" };
const minutes = (s) => (s < 90 ? "about a minute" : `about ${Math.round(s / 60)} minutes`);

async function post(url, body) {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error || "Something went wrong");
  return data;
}

function Panel({ title, icon = null, count = null, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 text-left text-sm font-semibold text-gray-900">
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        {icon}{title}{count != null && <span className="font-normal text-gray-500">({count})</span>}
      </button>
      {open && <div className="mt-3">{children}</div>}
    </div>
  );
}

/* ---- sources (side) ------------------------------------------------------ */

function SourcesSide({ listingId, owner, sync, sources, onChanged }) {
  const [menu, setMenu] = useState(false);
  const [mode, setMode] = useState(null);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(null);
  const fileRef = useRef(null);
  const running = !!sync?.job;

  const addUrl = async () => {
    if (!url.trim()) return;
    setBusy("url");
    try {
      await post(`/api/landlord/listings/${listingId}/agent/url`, { url: url.trim() });
      toast.success("Reading the whole site. You can leave this page; it keeps going.");
      setUrl(""); setMode(null);
      onChanged();
    } catch (err) { toast.error(err.message); } finally { setBusy(null); }
  };
  const syncNow = async () => {
    setBusy("sync");
    try {
      const r = await post(`/api/landlord/listings/${listingId}/agent/sync`, {});
      toast.success(r.already ? "A sync is already running." : "Sync started. You can leave this page; it keeps going.");
      onChanged();
    } catch (err) { toast.error(err.message); } finally { setBusy(null); }
  };
  const upload = async (file) => {
    if (!file) return;
    setBusy("doc");
    try {
      const { uploadUrl, key } = await post(`/api/landlord/listings/${listingId}/agent/documents`, { fileName: file.name, contentType: file.type, size: file.size });
      const put = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
      if (!put.ok) throw new Error("Upload failed");
      const r = await post(`/api/landlord/listings/${listingId}/agent/documents`, { key, fileName: file.name, contentType: file.type });
      if (r.rejected) toast.error("That looks like one person's private paperwork, so it was not saved.");
      else toast.success(`Read. ${r.synthesis?.written ?? 0} new thing${r.synthesis?.written === 1 ? "" : "s"} saved${r.synthesis?.held ? `, ${r.synthesis.held} waiting for you` : ""}.`);
      setMode(null);
      onChanged();
    } catch (err) {
      toast.error(err.message === "Failed to fetch" ? "The upload was blocked before it reached storage. On a preview site the storage bucket has to allow this address." : err.message);
    } finally { setBusy(null); if (fileRef.current) fileRef.current.value = ""; }
  };

  const pages = (sources ?? []).filter((s) => s.kind === "page");
  const docs = (sources ?? []).filter((s) => s.kind === "document");

  return (
    <div className="space-y-3">
      <div className="relative">
        <button type="button" onClick={() => setMenu((m) => !m)} className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-gray-400 px-3 py-2.5 text-sm font-semibold text-gray-800 hover:bg-gray-50">
          <Plus className="h-4 w-4" /> Add source
        </button>
        {menu && (
          <div className="absolute left-0 right-0 z-10 mt-1 rounded-xl border border-gray-200 bg-white p-1 shadow-lg">
            <button type="button" onClick={() => { setMode(null); setMenu(false); setTimeout(() => fileRef.current?.click(), 50); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-gray-50"><Upload className="h-4 w-4" /> File</button>
            <button type="button" disabled={!owner} onClick={() => { setMode("website"); setMenu(false); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-gray-50 disabled:opacity-40" title={owner ? "" : "Only the property owner can add the website"}><Globe className="h-4 w-4" /> Website</button>
          </div>
        )}
      </div>
      <input ref={fileRef} type="file" accept="application/pdf,image/*,text/plain" onChange={(e) => upload(e.target.files?.[0])} className="hidden" />
      {busy === "doc" && <p className="text-xs text-gray-500">Reading your file...</p>}
      {mode === "website" && (
        <form onSubmit={(e) => { e.preventDefault(); addUrl(); }} className="space-y-2 rounded-xl border border-gray-200 bg-white p-3">
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://your-building.com" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
          <div className="flex gap-2">
            <button type="submit" disabled={busy === "url" || !url.trim()} className="rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">{busy === "url" ? "Adding..." : "Add website"}</button>
            <button type="button" onClick={() => setMode(null)} className="text-xs text-gray-500">Cancel</button>
          </div>
        </form>
      )}

      <div className="rounded-xl border border-gray-200 bg-white p-3 text-sm">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Sources</p>
        {sync?.hasSource && (
          <div className="mb-3 space-y-1">
            <p className="flex items-center gap-1.5 font-medium text-gray-900"><Link2 className="h-3.5 w-3.5" /> Website</p>
            <a href={sync.sourceUrl} target="_blank" rel="noopener noreferrer" className="block truncate text-xs text-red-600 hover:underline" title={sync.sourceUrl}>{sync.sourceUrl.replace(/^https?:\/\/(www\.)?/, "")}</a>
            {running ? (
              <div className="rounded-lg bg-gray-50 p-2 text-xs text-gray-700">
                <p className="font-medium">{sync.job.step || "Syncing"}{typeof sync.job.progress === "number" ? ` (${sync.job.progress}%)` : ""}</p>
                <p className="text-gray-500">Usually takes {minutes(sync.estimateSeconds ?? 180)}. You can leave this page; it keeps running.</p>
              </div>
            ) : (
              <>
                <p className="text-xs text-gray-500">Last read {when(sync.lastCheckedAt) || "never"}. Checked every day.</p>
                <button disabled={busy === "sync"} onClick={syncNow} className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1 text-xs disabled:opacity-50"><RefreshCw className="h-3 w-3" /> Read the whole site now ({sync.manualLeft} left today)</button>
                <p className="text-[11px] text-gray-400">Takes {minutes(sync.estimateSeconds ?? 180)}. You can leave while it runs.</p>
              </>
            )}
            {pages.length > 1 && <p className="text-[11px] text-gray-500">{pages.length} pages read</p>}
          </div>
        )}
        {docs.map((d) => (
          <p key={d.id} className="flex items-center gap-1.5 truncate py-0.5 text-xs text-gray-700"><FileText className="h-3.5 w-3.5 shrink-0" /> {String(d.label ?? "").replace(/^Document: /, "")}</p>
        ))}
        {!sync?.hasSource && !docs.length && <p className="text-xs text-gray-500">Add your website or a file so Proxy can answer more.</p>}
      </div>
    </div>
  );
}

/* ---- below --------------------------------------------------------------- */

function HeldChanges({ listingId, held, onDone }) {
  const [busy, setBusy] = useState(null);
  if (!held.length) return null;
  const decide = async (h, decision) => {
    setBusy(h.id);
    try {
      await post(`/api/landlord/listings/${listingId}/agent/changes`, { kind: h.kind, eventId: h.id, decision });
      toast.success(decision === "approve" ? "Applied" : "Kept as it was");
      onDone();
    } catch (err) { toast.error(err.message); } finally { setBusy(null); }
  };
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
      <p className="mb-1 text-sm font-semibold text-amber-900">Waiting for you ({held.length})</p>
      <p className="mb-3 text-xs text-amber-800">Your website (or a document) says something different from what you set. Nothing changes until you decide.</p>
      <div className="space-y-2">
        {held.map((h) => (
          <div key={h.id} className="rounded-lg bg-white p-3 text-sm">
            <p className="text-gray-900">{h.title}</p>
            {h.current && <p className="text-xs text-gray-500">Currently: {h.current}</p>}
            {h.forAdmin ? <p className="mt-1 text-xs text-gray-500">Being reviewed by the Proximity team.</p> : (
              <div className="mt-2 flex gap-2">
                <button disabled={busy === h.id} onClick={() => decide(h, "approve")} className="inline-flex items-center gap-1 rounded-lg bg-gray-900 px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"><CheckCircle2 className="h-3 w-3" /> Apply</button>
                <button disabled={busy === h.id} onClick={() => decide(h, "reject")} className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1 text-xs text-gray-700 disabled:opacity-50"><XCircle className="h-3 w-3" /> Keep mine</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function FactRow({ listingId, f, onChanged }) {
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(f.summary);
  const [busy, setBusy] = useState(false);
  const act = async (payload, ok) => {
    setBusy(true);
    try {
      const r = await post(`/api/landlord/listings/${listingId}/agent/facts`, { factId: f.id, ...payload });
      if (r.held) toast(r.reason, { icon: "⏳" }); else toast.success(ok);
      setEditing(false);
      onChanged();
    } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };
  const path = f.sourceUrl ? f.sourceUrl.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "") : null;
  return (
    <li className="relative flex items-start justify-between gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-gray-50">
      <div className="min-w-0 flex-1">
        {editing ? (
          <div className="space-y-1.5">
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} className="w-full resize-none rounded-lg border border-gray-300 px-2 py-1.5 text-sm" />
            <div className="flex gap-2">
              <button disabled={busy || !text.trim()} onClick={() => act({ action: "edit", summary: text.trim() }, "Updated")} className="rounded-lg bg-gray-900 px-3 py-1 text-xs font-semibold text-white disabled:opacity-50">Save</button>
              <button onClick={() => { setEditing(false); setText(f.summary); }} className="text-xs text-gray-500">Cancel</button>
            </div>
          </div>
        ) : (
          <>
            <span className={f.stale ? "text-gray-400 line-through" : "text-gray-900"}>{f.summary}</span>
            {f.scope.label && <span className="ml-1 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600">{f.scope.label}</span>}
            <div className="text-[11px] text-gray-500">
              {path ? <a href={f.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-red-600 hover:underline">{path}</a> : f.source}
              {" · "}updated {when(f.updatedAt)}{f.validUntil ? ` · until ${when(f.validUntil)}` : ""}{f.stale ? " · stale, please confirm" : ""}
            </div>
          </>
        )}
      </div>
      {f.canEdit && !editing && (
        <div className="relative shrink-0">
          <button type="button" onClick={() => setMenu((m) => !m)} aria-label="Fact options" className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"><MoreHorizontal className="h-4 w-4" /></button>
          {menu && (
            <div className="absolute right-0 z-10 mt-1 w-28 rounded-lg border border-gray-200 bg-white p-1 shadow-lg" onMouseLeave={() => setMenu(false)}>
              <button type="button" onClick={() => { setMenu(false); setEditing(true); }} className="block w-full rounded-md px-3 py-1.5 text-left text-sm hover:bg-gray-50">Edit</button>
              <button type="button" disabled={busy} onClick={() => { setMenu(false); act({ action: "delete" }, "Deleted"); }} className="block w-full rounded-md px-3 py-1.5 text-left text-sm text-red-600 hover:bg-red-50">Delete</button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function Knowledge({ listingId, sections, onChanged }) {
  const total = Object.values(sections).reduce((n, a) => n + a.length, 0);
  return (
    <Panel title="What your agent knows" count={total}>
      <p className="mb-2 text-xs text-gray-500">Rent, beds and availability come from your listing itself. Everything else Proxy tells students is here, with where it came from.</p>
      {total === 0 && <p className="text-sm text-gray-500">Nothing yet. Tell the agent something, or add your website or a file.</p>}
      {["fees", "policies", "specials", "misc", "core"].map((s) => sections[s]?.length ? (
        <div key={s} className="mb-3">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">{SECTION_LABELS[s]} ({sections[s].length})</p>
          <ul className="space-y-0.5">
            {sections[s].map((f) => <FactRow key={f.id} listingId={listingId} f={f} onChanged={onChanged} />)}
          </ul>
        </div>
      ) : null)}
    </Panel>
  );
}

function ChangeHistory({ listingId, history, onDone }) {
  const [busy, setBusy] = useState(null);
  if (!history.length) return null;
  const revert = async (e) => {
    setBusy(e.id);
    try {
      await post(`/api/landlord/listings/${listingId}/agent/changes`, { revert: e.id });
      toast.success("Reverted");
      onDone();
    } catch (err) { toast.error(err.message); } finally { setBusy(null); }
  };
  return (
    <Panel title="Change history" icon={<History className="h-4 w-4 text-red-600" />} count={history.length} defaultOpen={false}>
      <ul className="space-y-1.5">
        {history.map((e) => (
          <li key={e.id} className="flex items-start justify-between gap-2 text-sm">
            <div>
              <span className="text-xs text-gray-500">{when(e.createdAt)} · {e.cause.replace(/_/g, " ")}{e.status === "reverted" ? " · reverted" : ""}</span>
              <div className={e.status === "reverted" ? "text-gray-400 line-through" : "text-gray-900"}>{e.summary ?? e.key}</div>
              {e.oldSummary && <div className="text-xs text-gray-500">was: {e.oldSummary}</div>}
            </div>
            {e.canRevert && <button disabled={busy === e.id} onClick={() => revert(e)} className="shrink-0 text-xs text-red-600 underline disabled:opacity-50">Revert</button>}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export default function AgentTab({ listingId, viewAsId = null, isDraft = false }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const load = useCallback(async () => {
    try {
      const qs = viewAsId ? `?viewAs=${encodeURIComponent(viewAsId)}` : "";
      const r = await fetch(`/api/landlord/listings/${listingId}/agent${qs}`);
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error || "Could not load the agent");
      setData(d);
      setError(null);
    } catch (err) { setError(err.message); }
  }, [listingId, viewAsId]);
  useEffect(() => { load(); }, [load]);
  // While a sync runs, keep its progress fresh.
  const runningId = data?.sync?.job?.id ?? null;
  useEffect(() => {
    if (!runningId) return;
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [runningId, load]);

  if (error) return <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  if (!data) return <ChatSkeleton rows={4} />;

  const live = data.sync?.agent && ["pilot", "on"].includes(data.sync.agent.status);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-600">
        <span>Proxy answering students: <strong>{isDraft ? "after you publish" : live ? "on" : "not yet"}</strong></span>
        <span>Open questions: <strong>{data.openQuestions}</strong></span>
      </div>
      <div className="grid gap-4 md:grid-cols-[1fr_260px]">
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <LandlordProxyChat listingId={listingId} viewAsId={viewAsId} maxHeight="max-h-[520px] min-h-[300px]" onChanged={load} />
        </div>
        <SourcesSide listingId={listingId} owner={data.owner} sync={data.sync} sources={data.sources} onChanged={load} />
      </div>
      <HeldChanges listingId={listingId} held={data.held} onDone={load} />
      <Knowledge listingId={listingId} sections={data.sections} onChanged={load} />
      <ChangeHistory listingId={listingId} history={data.history} onDone={load} />
    </div>
  );
}
