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
 * The panel is mounted with the listing (hidden until the Contact tab) so
 * the thread is loaded before the student gets there; when the tab opens
 * the modal scrolls to the bottom of the panel, and the conversation stays
 * pinned to its newest message while an answer types out.
 *
 * A question Proxy had to send on reads as a plain Proxy message that says
 * so and how the answer will reach them; a signed-out visitor is asked for
 * their email in that message and types it into the chat (visitorEmail.js).
 *
 * Message kinds, from the API (all drawn the same: one grey Proxy bubble,
 * no labels; Proxy writes everything in its own words, Wyatt 2026-10-27):
 *   mine          the student's own messages
 *   proxy_answer  Proxy, from the listing's details ("Based on details
 *                 updated Oct 24" underneath when it drew on dated facts)
 *   proxy_asked   Proxy sent something to the landlord
 *   proxy_relay   what the landlord said, in Proxy's words; with `clarifier`
 *                 it carries the landlord's question back
 *   proxy_note    an update: a correction, or no answer yet
 *
 * While the panel is on screen it polls the thread every 15 seconds, so a
 * landlord's reply shows up without a reload, and every poll marks the
 * thread read, which is what stops the email Proxy would otherwise send for
 * an answer the student already saw here.
 *
 * The owner's "View as Student" preview and admins get test mode: real
 * answers, nothing logged or sent on.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { signIn } from "next-auth/react";
import toast from "react-hot-toast";
import { Send, Sparkles, Flag } from "lucide-react";
import { useTour, TourButton, TourCard } from "./TourMarker";
import ChatSkeleton from "@/components/chat/ChatSkeleton";

const money = (n) => (n == null ? null : `$${Number(n).toLocaleString("en-US")}`);

// The listing page and the Messages overlay can mount a panel for the same
// listing in the same moment; they share one open-thread request.
const threadOpens = new Map();
function openThread(listingId, leaseId) {
  const key = `${listingId}:${leaseId ?? ""}`;
  if (!threadOpens.has(key)) {
    const p = fetch("/api/proxy/threads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ listingId, leaseId }) })
      .then(async (r) => ({ ok: r.ok, data: await r.json().catch(() => ({})) }))
      .finally(() => threadOpens.delete(key));
    threadOpens.set(key, p);
  }
  return threadOpens.get(key);
}
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
  return (
    <div className="flex items-start gap-2">
      <div className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-red-50">
        <Sparkles className="h-3 w-3 text-red-600" />
      </div>
      <div className="max-w-[85%]">
        <div className="rounded-2xl rounded-tl-sm bg-gray-100 px-3.5 py-2 text-sm leading-relaxed text-gray-900 whitespace-pre-wrap">
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

export default function ProxyPanel({ listing, session, selectedLease = null, unitLabel = null, preview = false, active = true, showTour = true, onTourIntent = null }) {
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
  const [bookingOpen, setBookingOpen] = useState(false);
  // Messages that arrived in this session type themselves out.
  const [fresh, setFresh] = useState(() => new Set());
  const endRef = useRef(null);
  const inputRef = useRef(null);
  const rootRef = useRef(null);
  const listRef = useRef(null);
  const signedIn = !!session?.user?.id;
  const started = messages.length > 0 || sending;
  // The tour on this conversation (a marker on the top line, its card below).
  const { tour, setTour } = useTour(listingId, signedIn);

  useEffect(() => {
    if (!listingId) return;
    let cancelled = false;
    setLoading(true);
    openThread(listingId, leaseId)
      .then(({ ok, data }) => {
        if (cancelled) return;
        if (!ok) { setUnavailable(data?.error || "Proxy is not available on this listing yet."); return; }
        setThread(data.thread);
        setMessages(data.messages ?? []);
        setTestMode(!!data.testMode);
      })
      .catch(() => { if (!cancelled) setUnavailable("Proxy could not load just now."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // The thread is opened once per listing; the lease rides on each message.
  }, [listingId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Poll while on screen and visible: new messages (a landlord's reply) come
  // in and type out, and the server marks the thread read.
  const refresh = useCallback(async () => {
    if (!thread || typeof document === "undefined" || document.visibilityState !== "visible") return;
    try {
      const r = await fetch(`/api/proxy/threads/${thread.id}`);
      if (!r.ok) return;
      const data = await r.json();
      const incoming = data.messages ?? [];
      setMessages((m) => {
        const have = new Set(m.map((x) => x.id));
        const extra = incoming.filter((x) => !have.has(x.id));
        if (!extra.length) return m;
        setFresh((f) => new Set([...f, ...extra.filter((x) => x.fromProxy).map((x) => x.id)]));
        return [...m, ...extra];
      });
    } catch {}
  }, [thread]);

  useEffect(() => {
    if (!active || !thread || sending) return;
    const t = setInterval(refresh, 15000);
    return () => clearInterval(t);
  }, [active, thread, sending, refresh]);

  // The conversation stays pinned to its newest message: the list's own
  // scroll follows every change (an answer typing out grows the text node by
  // node), and the modal keeps the bottom of the panel in view.
  useEffect(() => {
    const el = listRef.current;
    if (!el || !active) return;
    const pin = () => {
      el.scrollTop = el.scrollHeight;
      rootRef.current?.scrollIntoView({ block: "end" });
    };
    const obs = new MutationObserver(pin);
    obs.observe(el, { childList: true, characterData: true, subtree: true });
    return () => obs.disconnect();
  }, [active, started]);

  // Opening the Contact tab glides to the bottom of the panel (the input),
  // after the modal's own jump to the tab strip has happened.
  useEffect(() => {
    if (!active || loading) return;
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    const t = setTimeout(() => rootRef.current?.scrollIntoView({ block: "end", behavior: "smooth" }), 180);
    return () => clearTimeout(t);
  }, [active, loading]);

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
      if (data.intent === "tour" && session?.user?.id) { if (showTour) setBookingOpen(true); else onTourIntent?.(); }
      // Seen on the page: no email for this answer.
      if (active) refresh();
    } catch {
      setMessages((m) => m.filter((x) => x.id !== temp.id));
      setInput(text);
      toast.error("Proxy could not answer just now.");
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }, [input, thread, sending, leaseId, session?.user?.id, active, refresh, showTour, onTourIntent]);

  const report = useCallback(async (msg) => {
    if (!thread) return;
    try {
      await fetch(`/api/proxy/threads/${thread.id}/report`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messageId: msg.id }) });
      toast.success("Thanks, we'll take a look at that answer.");
    } catch {
      toast.error("Could not send the report.");
    }
  }, [thread]);

  const aboutLabel = selectedLease
    ? `${unitLabel ?? "this unit"}${selectedLease.rent ? ` at ${money(selectedLease.rent)}/mo` : ""}`
    : unitLabel ?? "this place";

  if (unavailable) {
    return <div className="rounded-xl border border-gray-200 bg-gray-50 p-5 text-sm text-gray-600">{unavailable}</div>;
  }

  const tourShown = showTour && !testMode && choices.length > 0;

  return (
    <div ref={rootRef} className="flex flex-col gap-3">
      {testMode && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Test mode: you are trying Proxy on {preview ? "your own" : "this"} listing. Answers are real; nothing is logged, counted or sent to a landlord.
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-gray-700">
          Asking about <span className="font-semibold text-gray-900">{aboutLabel}</span>
        </p>
        {tourShown && <TourButton tour={tour} signedIn={signedIn} open={bookingOpen} onOpenChange={setBookingOpen} />}
      </div>

      {tourShown && bookingOpen && signedIn && (
        <TourCard listing={listing} leaseChoices={choices} leaseId={leaseId} proxyThreadId={thread?.id ?? null} onClose={() => setBookingOpen(false)} setTour={setTour} />
      )}

      <div className="rounded-2xl border-2 border-gray-300 bg-white shadow-md">
        {loading && <ChatSkeleton rows={3} className="border-b border-gray-100 p-4" />}
        {started && (
          <div ref={listRef} className="flex max-h-[480px] flex-col gap-3 overflow-y-auto border-b border-gray-100 p-4">
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
          <form onSubmit={(e) => { e.preventDefault(); send(); }} className="flex items-end gap-2 p-3">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              rows={started ? 2 : 3}
              maxLength={2000}
              placeholder={started ? "Ask a follow-up" : "Ask about fees, pets, parking, lease terms, move-in dates..."}
              disabled={loading || sending || !thread}
              className="flex-1 resize-none rounded-lg border-0 px-2 py-2 text-base focus:outline-none focus:ring-0"
            />
            <button type="submit" disabled={loading || sending || !input.trim()} className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-red-600 text-white disabled:opacity-40">
              <Send className="h-5 w-5" />
            </button>
          </form>
        )}
      </div>

    </div>
  );
}
