"use client";

/*
 * The Agent tab on a property's dashboard page (PRD v3, milestone 7).
 *
 * One conversation with the agent at the top (tell it something new or
 * change what students see; every write is confirmed first), then what is
 * waiting for the landlord, one place to add a source (a website or a
 * file), what the agent knows and where it came from, and the change
 * history with revert.
 *
 * Every write goes through the agent routes, which check ownership: the
 * property owner changes property-level things, every owner their own
 * leases, and nothing said in plain language can widen that.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { Sparkles, RefreshCw, Link2, Upload, History, ChevronDown, ChevronRight, CheckCircle2, XCircle } from "lucide-react";

const when = (iso) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "");
const SECTION_LABELS = { fees: "Fees", policies: "Policies", specials: "Specials and promotions", misc: "Other details", core: "Displayed fields set by you" };

async function post(url, body) {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error || "Something went wrong");
  return data;
}

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
      <p className="mb-2 text-sm font-semibold text-amber-900">Waiting for you ({held.length})</p>
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

function AgentChat({ listingId, onChanged }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [proposal, setProposal] = useState(null);
  const endRef = useRef(null);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "nearest" }); }, [messages.length, proposal]);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setBusy(true);
    setInput("");
    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    setMessages((m) => [...m, { role: "user", content: text }]);
    try {
      const r = await post(`/api/landlord/listings/${listingId}/agent/chat`, { message: text, history });
      setMessages((m) => [...m, { role: "assistant", content: r.reply }]);
      setProposal(r.hasChanges ? r.proposal : null);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!proposal || busy) return;
    setBusy(true);
    try {
      const r = await post(`/api/landlord/listings/${listingId}/agent/chat`, { confirm: proposal });
      const lines = [...(r.applied ?? []).map((a) => `Done: ${a}`), ...(r.held ?? []), ...(r.errors ?? []).map((e) => `Not done: ${e}`)];
      setMessages((m) => [...m, { role: "assistant", content: lines.join("\n") || "Nothing to do." }]);
      setProposal(null);
      onChanged();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <p className="mb-1 flex items-center gap-2 text-sm font-semibold text-gray-900"><Sparkles className="h-4 w-4 text-red-600" /> Talk to your agent</p>
      <p className="mb-3 text-xs text-gray-500">Tell it something new (&quot;parking is $75 a month&quot;), change what students see (&quot;lower the 2-bed to $1,450&quot;), or ask what it knows. You confirm before anything is saved.</p>
      <div className="mb-3 max-h-72 space-y-2 overflow-y-auto">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm ${m.role === "user" ? "bg-red-600 text-white" : "bg-gray-100 text-gray-900"}`}>{m.content}</div>
          </div>
        ))}
        {busy && <p className="text-xs text-gray-400">Thinking...</p>}
        {proposal && (
          <div className="rounded-lg border border-gray-300 bg-gray-50 p-3 text-sm">
            <p className="mb-2 font-semibold text-gray-900">Confirm these changes</p>
            <ul className="mb-3 space-y-1">
              {proposal.coreChanges.map((c, i) => <li key={`c${i}`} className={c.allowed === false || c.error ? "text-red-700" : "text-gray-800"}>{c.refLabel ?? c.ref}: {c.fieldLabel ?? c.field} to <strong>{String(c.value)}</strong>{c.error ? ` (${c.error})` : ""}</li>)}
              {proposal.facts.map((f, i) => <li key={`f${i}`} className={f.allowed === false ? "text-red-700" : "text-gray-800"}>Save: {f.summary}</li>)}
              {proposal.retireKeys.map((k) => <li key={k} className="text-gray-800">Remove: {k}</li>)}
            </ul>
            <div className="flex gap-2">
              <button disabled={busy} onClick={confirm} className="rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">Confirm</button>
              <button disabled={busy} onClick={() => setProposal(null)} className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-700">Cancel</button>
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>
      <form onSubmit={(e) => { e.preventDefault(); send(); }} className="flex gap-2">
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Tell your agent something, change a detail, or ask it a question" className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm" disabled={busy} />
        <button type="submit" disabled={busy || !input.trim()} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Send</button>
      </form>
    </div>
  );
}

function AddSource({ listingId, owner, sync, onChanged }) {
  const [mode, setMode] = useState("website");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(null);
  const fileRef = useRef(null);

  const addUrl = async () => {
    if (!url.trim()) return;
    setBusy("url");
    try {
      await post(`/api/landlord/listings/${listingId}/agent/url`, { url: url.trim() });
      toast.success("Reading your website. Differences will show here for you to confirm in a few minutes.");
      setUrl("");
      onChanged();
    } catch (err) { toast.error(err.message); } finally { setBusy(null); }
  };
  const syncNow = async () => {
    setBusy("sync");
    try {
      const r = await post(`/api/landlord/listings/${listingId}/agent/sync`, {});
      toast.success(r.already ? "A sync is already running." : "Sync started. It takes a few minutes.");
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
      onChanged();
    } catch (err) { toast.error(err.message); } finally { setBusy(null); if (fileRef.current) fileRef.current.value = ""; }
  };

  const tab = (key, label, Icon) => (
    <button type="button" onClick={() => setMode(key)} className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium ${mode === key ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}>
      <Icon className="h-3 w-3" /> {label}
    </button>
  );

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold text-gray-900">Add something</p>
        <div className="flex gap-1">{tab("website", "Website", Link2)}{tab("file", "File", Upload)}</div>
      </div>
      <p className="mb-3 text-xs text-gray-500">What your agent learns from it is saved with the source, so students (and you) can see where it came from.</p>
      {mode === "website" ? (
        sync?.hasSource ? (
          <>
            <p className="truncate text-xs text-gray-700" title={sync.sourceUrl}>{sync.sourceUrl}</p>
            <p className="text-xs text-gray-500">Last read {when(sync.lastCheckedAt) || "never"}{sync.lastStatus ? ` (${sync.lastStatus.replace(/_/g, " ")})` : ""}{sync.running ? " · running now" : ""}. It is re-read every day.</p>
            <button disabled={busy === "sync" || !!sync.running} onClick={syncNow} className="mt-2 inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1 text-xs disabled:opacity-50"><RefreshCw className="h-3 w-3" /> Sync now ({sync.manualLeft} left today)</button>
          </>
        ) : owner ? (
          <form onSubmit={(e) => { e.preventDefault(); addUrl(); }} className="flex gap-2">
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://your-building.com" className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            <button type="submit" disabled={busy === "url" || !url.trim()} className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy === "url" ? "Adding..." : "Add website"}</button>
          </form>
        ) : <p className="text-xs text-gray-500">The property owner can add the building&apos;s website.</p>
      ) : (
        <>
          <p className="text-xs text-gray-500">A fee sheet, flyer, brochure or policy PDF (or an image of one), up to 10MB. The file is read and deleted; only what it says is kept.</p>
          <input ref={fileRef} type="file" accept="application/pdf,image/*,text/plain" onChange={(e) => upload(e.target.files?.[0])} disabled={busy === "doc"} className="mt-2 w-full text-xs" />
          {busy === "doc" && <p className="mt-1 text-xs text-gray-400">Reading...</p>}
        </>
      )}
    </div>
  );
}

function Knowledge({ sections }) {
  const [open, setOpen] = useState({ fees: true, policies: true, specials: true, misc: true, core: false });
  const total = Object.values(sections).reduce((n, a) => n + a.length, 0);
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <p className="mb-1 text-sm font-semibold text-gray-900">What your agent knows ({total})</p>
      <p className="mb-3 text-xs text-gray-500">Rent, beds and availability come from your listing itself. Everything else Proxy tells students is here, with where it came from.</p>
      {total === 0 && <p className="text-sm text-gray-500">Nothing yet. Tell the agent something, or add your website or a file.</p>}
      {["fees", "policies", "specials", "misc", "core"].map((s) => sections[s]?.length ? (
        <div key={s} className="mb-2">
          <button type="button" onClick={() => setOpen((o) => ({ ...o, [s]: !o[s] }))} className="flex w-full items-center gap-1 text-left text-sm font-medium text-gray-800">
            {open[s] ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />} {SECTION_LABELS[s]} <span className="text-xs text-gray-500">({sections[s].length})</span>
          </button>
          {open[s] && (
            <ul className="ml-5 mt-1 space-y-1.5">
              {sections[s].map((f) => (
                <li key={f.id} className="text-sm">
                  <span className={f.stale ? "text-gray-400 line-through" : "text-gray-900"}>{f.summary}</span>
                  {f.scope.label && <span className="ml-1 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600">{f.scope.label}</span>}
                  {f.landlordSet && <span className="ml-1 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] text-emerald-800">set by you</span>}
                  <div className="text-[11px] text-gray-500">{f.source} · updated {when(f.updatedAt)}{f.validUntil ? ` · until ${when(f.validUntil)}` : ""}{f.stale ? " · stale, please confirm" : ""}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null)}
    </div>
  );
}

function ChangeHistory({ listingId, history, onDone }) {
  const [open, setOpen] = useState(false);
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
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 text-left text-sm font-semibold text-gray-900"><History className="h-4 w-4 text-red-600" /> Change history ({history.length}) {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</button>
      {open && (
        <ul className="mt-2 space-y-1.5">
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
      )}
    </div>
  );
}

export default function AgentTab({ listingId, viewAsId = null }) {
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

  if (error) return <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  if (!data) return <div className="py-6 text-center text-sm text-gray-400">Loading your agent...</div>;

  const live = data.sync?.agent && ["pilot", "on"].includes(data.sync.agent.status);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm">
        <div className="flex items-center gap-2 font-semibold text-gray-900"><Sparkles className="h-4 w-4 text-red-600" /> Your listing&apos;s agent</div>
        <div className="flex flex-wrap gap-3 text-xs text-gray-600">
          <span>Proxy answering students: <strong>{live ? "on" : "not yet"}</strong></span>
          <span>Open questions: <strong>{data.openQuestions}</strong></span>
          {data.sync?.lastCheckedAt && <span>Website last read {when(data.sync.lastCheckedAt)}</span>}
        </div>
      </div>
      <AgentChat listingId={listingId} onChanged={load} />
      <HeldChanges listingId={listingId} held={data.held} onDone={load} />
      <AddSource listingId={listingId} owner={data.owner} sync={data.sync} onChanged={load} />
      <Knowledge sections={data.sections} />
      <ChangeHistory listingId={listingId} history={data.history} onDone={load} />
    </div>
  );
}
