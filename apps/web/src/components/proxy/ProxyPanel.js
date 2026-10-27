"use client";

/*
 * "Ask": the Proxy conversation on a listing (PRD v3).
 *
 * One thread per listing per person, signed in or not. Proxy answers from the
 * listing's knowledge; what it cannot answer it sends to the landlord and
 * posts the answer back here. The landlord is never in this conversation.
 *
 * Layout (Wyatt, 2026-10-27): one line at the top says which lease the
 * student is asking about (the one whose Contact they clicked, or the open
 * unit's first offering) with Book a tour beside it; then one box that is
 * just the input until the first message, and the conversation after.
 *
 * Message kinds, from the API:
 *   mine          the student's own messages
 *   proxy_answer  Proxy, from the listing's details ("Based on details
 *                 updated Oct 24" underneath when it drew on dated facts)
 *   proxy_asked   Proxy sent something to the landlord
 *   proxy_relay   the landlord's answer, relayed by Proxy
 *   proxy_note    an update: a correction, or no answer yet
 *
 * The owner's "View as Student" preview and admins get test mode: real
 * answers, nothing logged or sent on.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { signIn } from "next-auth/react";
import toast from "react-hot-toast";
import { Send, Sparkles, Flag, CalendarDays } from "lucide-react";
import TourBooking from "./TourBooking";

const money = (n) => (n == null ? null : `$${Number(n).toLocaleString("en-US")}`);
const dateLabel = (iso) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : null);

function leaseChoices(listing) {
  const out = [];
  for (const u of listing?.unitTypes ?? []) {
    const unitLabel = u.name || ((u.bedrooms ?? 0) === 0 ? "Studio" : `${u.bedrooms ?? "?"} bed / ${u.bathrooms ?? "?"} bath`);
    for (const l of u.leases ?? []) {
      out.push({ id: l.id, label: `${unitLabel}${l.rent ? ` at ${money(l.rent)}/mo` : ""}` });
    }
  }
  return out;
}

/* Three bouncing dots in a Proxy bubble while an answer is being looked up. */
function TypingBubble() {
  return (
    <div className="flex items-start gap-2">
      <div className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-red-50">
        <Sparkles className="h-3 w-3 text-red-600" />
      </div>
      <div className="flex items-center gap-1 rounded-2xl rounded-tl-sm bg-gray-100 px-3.5 py-3">
        {[0, 150, 300].map((delay) => (
          <span key={delay} className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400" style={{ animationDelay: `${delay}ms` }} />
        ))}
      </div>
    </div>
  );
}

/*
 * A Proxy message types itself out, fast: a few characters per frame, so a
 * paragraph lands in well under a second. Only messages that arrived in
 * this session animate; history loads whole.
 */
function useTypeOut(text, animate) {
  const [shown, setShown] = useState(animate ? 0 : text.length);
  useEffect(() => {
    if (!animate) { setShown(text.length); return; }
    let i = 0;
    let raf;
    const step = () => {
      i = Math.min(text.length, i + Math.max(3, Math.ceil(text.length / 60)));
      setShown(i);
      if (i < text.length) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [text, animate]);
  return shown;
}

function Bubble({ msg, onReport, animate = false }) {
  const shown = useTypeOut(msg.body ?? "", animate && !msg.isMine);
  if (msg.isMine) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-red-600 px-3.5 py-2 text-sm leading-relaxed text-white whitespace-pre-wrap">{msg.body}</div>
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
      <div className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-red-50">
        <Sparkles className="h-3 w-3 text-red-600" />
      </div>
      <div className="max-w-[85%]">
        {chip && <span className={`mb-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${chip[1]}`}>{chip[0]}</span>}
        <div className={`rounded-2xl rounded-tl-sm px-3.5 py-2 text-sm leading-relaxed whitespace-pre-wrap ${msg.type === "proxy_note" ? "bg-gray-50 text-gray-600" : "bg-gray-100 text-gray-900"}`}>
          {(msg.body ?? "").slice(0, shown)}
        </div>
        {(msg.type === "proxy_answer") && shown >= (msg.body ?? "").length && (
          <div className="mt-0.5 flex items-center gap-3 text-[11px] text-gray-400">
            {msg.updatedAt && <span>Based on details updated {dateLabel(msg.updatedAt)}</span>}
            <button type="button" onClick={() => onReport(msg)} className="inline-flex items-center gap-1 hover:text-gray-600">
              <Flag className="h-3 w-3" /> Report
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ProxyPanel({ listing, session, selectedLease = null, unitLabel = null, preview = false }) {
  const listingId = listing?._id;
  const choices = leaseChoices(listing);
  const leaseId = selectedLease?.id ?? null;
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
  const [bookingOpen, setBookingOpen] = useState(false);
  // Messages that arrived in this session type themselves out.
  const [fresh, setFresh] = useState(() => new Set());
  const endRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!listingId) return;
    let cancelled = false;
    setLoading(true);
    fetch("/api/proxy/threads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ listingId, leaseId }) })
      .then(async (r) => ({ ok: r.ok, data: await r.json().catch(() => ({})) }))
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
      const incoming = data.messages ?? [];
      setFresh((f) => new Set([...f, ...incoming.filter((x) => x.fromProxy).map((x) => x.id)]));
      setMessages((m) => [...m.filter((x) => x.id !== temp.id), ...incoming]);
      if (data.intent === "tour" && session?.user?.id) setBookingOpen(true);
    } catch {
      setMessages((m) => m.filter((x) => x.id !== temp.id));
      setInput(text);
      toast.error("Proxy could not answer just now.");
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }, [input, thread, sending, leaseId, session?.user?.id]);

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
  const started = messages.length > 0 || sending;
  const aboutLabel = selectedLease
    ? `${unitLabel ?? "this unit"}${selectedLease.rent ? ` at ${money(selectedLease.rent)}/mo` : ""}`
    : unitLabel ?? "this place";

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

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-gray-700">
          Asking about <span className="font-semibold text-gray-900">{aboutLabel}</span>
        </p>
        {!testMode && choices.length > 0 && !bookingOpen && (
          signedIn ? (
            <button type="button" onClick={() => setBookingOpen(true)} className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white">
              <CalendarDays className="h-3.5 w-3.5" /> Book a tour
            </button>
          ) : (
            <button type="button" onClick={() => signIn()} className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white">
              <CalendarDays className="h-3.5 w-3.5" /> Sign in to book a tour
            </button>
          )
        )}
      </div>

      {bookingOpen && signedIn && (
        <TourBooking listing={listing} leaseChoices={choices} initialLeaseId={leaseId} proxyThreadId={thread?.id ?? null} onClose={() => setBookingOpen(false)} />
      )}

      <div className="rounded-xl border border-gray-200 bg-white">
        {started && (
          <div className="flex max-h-[420px] flex-col gap-3 overflow-y-auto border-b border-gray-100 p-3">
            {messages.map((m) => <Bubble key={m.id} msg={m} onReport={report} animate={fresh.has(m.id)} />)}
            {sending && <TypingBubble />}
            <div ref={endRef} />
          </div>
        )}
        {signInNeeded ? (
          <div className="p-3 text-sm text-red-700">
            Sign in to keep asking.{" "}
            <button type="button" onClick={() => signIn()} className="font-semibold underline">Sign in</button>
          </div>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); send(); }} className="flex items-end gap-2 p-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              rows={started ? 1 : 2}
              maxLength={2000}
              placeholder={started ? "Ask a follow-up" : "Ask about fees, pets, parking, lease terms, move-in dates..."}
              disabled={loading || sending || !thread}
              className="flex-1 resize-none rounded-lg border-0 px-2 py-2 text-sm focus:outline-none focus:ring-0"
            />
            <button type="submit" disabled={loading || sending || !input.trim()} className="inline-flex h-9 items-center gap-1 rounded-lg bg-red-600 px-3 text-sm font-semibold text-white disabled:opacity-40">
              <Send className="h-4 w-4" />
            </button>
          </form>
        )}
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
    </div>
  );
}
