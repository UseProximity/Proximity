"use client";

/*
 * "Ask about this place": the Proxy conversation on a listing (PRD v3).
 *
 * One thread per listing per person, signed in or not. Proxy answers from the
 * listing's knowledge; what it cannot answer it sends to the landlord and
 * posts the answer back here. The landlord is never in this conversation.
 *
 * Message kinds, from the API:
 *   mine          the student's own messages
 *   proxy_answer  Proxy, from the listing's details ("Based on details
 *                 updated Oct 24" underneath when it drew on dated facts)
 *   proxy_asked   Proxy sent something to the landlord
 *   proxy_relay   the landlord's answer, relayed by Proxy
 *   proxy_note    an update: a correction, or no answer yet
 *
 * The lease picker decides which owner a question goes to (contacts are per
 * lease). It is hidden when there is only one lease. A signed-out visitor
 * who has had a question sent on is offered a one-line email box to hear
 * back; that address is never shown to the landlord.
 *
 * The owner's "View as Student" preview and admins get test mode: real
 * answers, nothing logged or sent on.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { signIn } from "next-auth/react";
import toast from "react-hot-toast";
import { Send, Sparkles, Flag } from "lucide-react";

const money = (n) => (n == null ? null : `$${Number(n).toLocaleString("en-US")}`);
const dateLabel = (iso) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : null);

function leaseChoices(listing) {
  const out = [];
  for (const u of listing?.unitTypes ?? []) {
    const unitLabel = u.name || ((u.bedrooms ?? 0) === 0 ? "Studio" : `${u.bedrooms ?? "?"} bed / ${u.bathrooms ?? "?"} bath`);
    for (const l of u.leases ?? []) {
      // Unit and price only: Proxy keeps names out of the conversation.
      out.push({ id: l.id, label: `${unitLabel}${l.rent ? ` at ${money(l.rent)}/mo` : ""}` });
    }
  }
  return out;
}

function Bubble({ msg, onReport }) {
  if (msg.isMine) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-red-600 px-3.5 py-2.5 text-sm leading-relaxed text-white whitespace-pre-wrap">{msg.body}</div>
      </div>
    );
  }
  const chip =
    msg.type === "proxy_asked" ? ["Asked the landlord", "bg-amber-100 text-amber-800"]
    : msg.type === "proxy_relay" ? ["From the landlord", "bg-emerald-100 text-emerald-800"]
    : msg.type === "proxy_note" ? ["Update", "bg-gray-200 text-gray-700"]
    : null;
  return (
    <div className="flex items-start gap-2">
      <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-red-100 bg-red-50">
        <Sparkles className="h-3.5 w-3.5 text-red-600" />
      </div>
      <div className="max-w-[85%]">
        <div className="mb-0.5 flex items-center gap-2 text-[11px] text-gray-500">
          <span className="font-semibold text-gray-700">Proxy</span>
          {chip && <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${chip[1]}`}>{chip[0]}</span>}
        </div>
        <div className={`rounded-2xl rounded-tl-sm px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${msg.type === "proxy_note" ? "bg-gray-50 text-gray-600" : "bg-gray-100 text-gray-900"}`}>
          {msg.body}
        </div>
        <div className="mt-0.5 flex items-center gap-3 text-[11px] text-gray-400">
          {msg.type === "proxy_answer" && msg.updatedAt && <span>Based on details updated {dateLabel(msg.updatedAt)}</span>}
          {msg.type === "proxy_answer" && (
            <button type="button" onClick={() => onReport(msg)} className="inline-flex items-center gap-1 hover:text-gray-600">
              <Flag className="h-3 w-3" /> Report
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ProxyPanel({ listing, session, selectedLease = null, preview = false }) {
  const listingId = listing?._id;
  const choices = useMemo(() => leaseChoices(listing), [listing]);
  const [leaseId, setLeaseId] = useState(selectedLease?.id ?? null);
  const [thread, setThread] = useState(null);
  const [messages, setMessages] = useState([]);
  const [testMode, setTestMode] = useState(false);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [signInNeeded, setSignInNeeded] = useState(false);
  const [notifyEmail, setNotifyEmail] = useState("");
  const [notifySaved, setNotifySaved] = useState(false);
  const endRef = useRef(null);

  useEffect(() => { if (selectedLease?.id) setLeaseId(selectedLease.id); }, [selectedLease?.id]);

  useEffect(() => {
    if (!listingId) return;
    let cancelled = false;
    setLoading(true);
    fetch("/api/proxy/threads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ listingId, leaseId }) })
      .then(async (r) => ({ ok: r.ok, status: r.status, data: await r.json().catch(() => ({})) }))
      .then(({ ok, data }) => {
        if (cancelled) return;
        if (!ok) { setUnavailable(data?.error || "Proxy is not available on this listing yet."); return; }
        setThread(data.thread);
        setMessages(data.messages ?? []);
        setTestMode(!!data.testMode);
        setNotifySaved(!!data.thread?.hasNotifyEmail);
      })
      .catch(() => { if (!cancelled) setUnavailable("Proxy could not load just now."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // The thread is opened once per listing; the lease rides on each message.
  }, [listingId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { endRef.current?.scrollIntoView({ block: "nearest" }); }, [messages.length, sending]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || !thread || sending) return;
    setSending(true);
    setInput("");
    const temp = { id: `temp-${Date.now()}`, body: text, isMine: true, type: "text" };
    setMessages((m) => [...m, temp]);
    try {
      const r = await fetch(`/api/proxy/threads/${thread.id}/messages`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body: text, leaseId }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        setMessages((m) => m.filter((x) => x.id !== temp.id));
        setInput(text);
        if (data?.code === "SIGN_IN") setSignInNeeded(true);
        toast.error(data?.error || "Proxy could not answer just now.");
        return;
      }
      setMessages((m) => [...m.filter((x) => x.id !== temp.id), ...(data.messages ?? [])]);
    } catch {
      setMessages((m) => m.filter((x) => x.id !== temp.id));
      setInput(text);
      toast.error("Proxy could not answer just now.");
    } finally {
      setSending(false);
    }
  }, [input, thread, sending, leaseId]);

  const report = useCallback(async (msg) => {
    if (!thread) return;
    try {
      await fetch(`/api/proxy/threads/${thread.id}/report`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messageId: msg.id }) });
      toast.success("Thanks, we'll take a look at that answer.");
    } catch {
      toast.error("Could not send the report.");
    }
  }, [thread]);

  const saveNotify = useCallback(async () => {
    if (!thread) return;
    const r = await fetch(`/api/proxy/threads/${thread.id}/notify-email`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: notifyEmail }) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) { toast.error(data?.error || "Could not save that."); return; }
    setNotifySaved(true);
    toast.success("We'll email you when the landlord answers.");
  }, [thread, notifyEmail]);

  const asked = messages.some((m) => m.type === "proxy_asked");
  const signedIn = !!session?.user?.id;

  if (unavailable) {
    return <div className="rounded-xl border border-gray-200 bg-gray-50 p-5 text-sm text-gray-600">{unavailable}</div>;
  }

  return (
    <div className="flex flex-col gap-3">
      {testMode && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Test mode: you are trying Proxy on {preview ? "your own" : "this"} listing. Answers are real; nothing is logged, counted or sent to a landlord.
        </div>
      )}
      <p className="text-xs text-gray-500">
        Proxy answers most questions instantly from this listing&apos;s details and passes the rest to the landlord. Answers are compiled from several sources and may be inaccurate; confirm anything important with the landlord before signing.
      </p>

      {choices.length > 1 && (
        <label className="flex flex-col gap-1 text-xs text-gray-600">
          Which lease are you asking about?
          <select value={leaseId ?? ""} onChange={(e) => setLeaseId(e.target.value || null)} className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm text-gray-900">
            <option value="">Not sure yet</option>
            {choices.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </label>
      )}

      <div className="flex max-h-[420px] min-h-[160px] flex-col gap-3 overflow-y-auto rounded-xl border border-gray-200 bg-white p-3">
        {loading && <div className="py-6 text-center text-sm text-gray-400">Opening your conversation...</div>}
        {!loading && messages.length === 0 && (
          <div className="py-6 text-center text-sm text-gray-400">Ask anything about this place: fees, pets, parking, lease terms, move-in dates.</div>
        )}
        {messages.map((m) => <Bubble key={m.id} msg={m} onReport={report} />)}
        {sending && (
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <Sparkles className="h-3.5 w-3.5 animate-pulse text-red-400" /> Proxy is looking that up...
          </div>
        )}
        <div ref={endRef} />
      </div>

      {asked && !signedIn && !notifySaved && !testMode && (
        <div className="flex flex-col gap-2 rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600 sm:flex-row sm:items-center">
          <span className="flex-1">Want an email when the landlord answers? It is never shown to them.</span>
          <div className="flex gap-2">
            <input type="email" value={notifyEmail} onChange={(e) => setNotifyEmail(e.target.value)} placeholder="you@wustl.edu" className="w-44 rounded-lg border border-gray-300 px-2 py-1.5 text-sm" />
            <button type="button" onClick={saveNotify} className="rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white">Notify me</button>
          </div>
        </div>
      )}

      {signInNeeded ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          Sign in to keep asking.{" "}
          <button type="button" onClick={() => signIn()} className="font-semibold underline">Sign in</button>
        </div>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); send(); }} className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            rows={2}
            maxLength={2000}
            placeholder="Ask Proxy about this place"
            disabled={loading || sending || !thread}
            className="flex-1 resize-none rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-red-400 focus:outline-none"
          />
          <button type="submit" disabled={loading || sending || !input.trim()} className="inline-flex h-10 items-center gap-1 rounded-xl bg-red-600 px-4 text-sm font-semibold text-white disabled:opacity-50">
            <Send className="h-4 w-4" /> Send
          </button>
        </form>
      )}
    </div>
  );
}
