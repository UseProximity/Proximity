"use client";

/*
 * "Ask": the Proxy conversation on a listing (PRD v3).
 *
 * One thread per listing per person, signed in or not. Proxy answers from the
 * listing's knowledge; what it cannot answer it sends to the landlord and
 * posts the answer back here. The landlord is never in this conversation.
 *
 * Layout (Wyatt, 2026-10-27, round 6; round 7, 2026-10-28): on the listing,
 * one line at the top says which lease the student is asking about (not in
 * the Messages popup, `showAbout`); the conversation sits straight in the
 * section (no box or border). The input is always on screen: on the listing
 * it renders into `inputSlot`, a bar pinned to the bottom of the listing
 * (ListingModalInfo), and in the popup the panel fills its height (`fill`)
 * with the input at the bottom. Sending or receiving a message scrolls the
 * chat and the page around it to the very bottom. Consecutive messages
 * from the same side stack with one icon. Every tour control lives in the
 * input: the calendar button beside Send opens TourPicker, its choice
 * becomes a chip ("2 day availability"), and sending sends the request.
 * Panels open on the same thread (the listing page and the Messages popup)
 * tell each other when something new arrives, so both stay in step.
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
import { createPortal } from "react-dom";
import { signIn } from "next-auth/react";
import toast from "react-hot-toast";
import Link from "next/link";
import { Send, Sparkles, Flag, CalendarDays, X } from "lucide-react";
import { useTour } from "./TourMarker";
import TourPicker from "./TourPicker";
import { availabilitySummary } from "@/lib/agents/tourTime";
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

// Panels on the same thread hear about each other's new messages at once.
const SYNC_EVENT = "proxy:thread-updated";
const announce = (threadId, source) => {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(SYNC_EVENT, { detail: { threadId, source } }));
};

/*
 * One message. `first` and `last` place it in a run of messages from the
 * same side: the Proxy icon shows once, on the first, and the corners
 * between stacked bubbles are tighter so the run reads as one block.
 */
function Bubble({ msg, onReport, animate = false, first = true, last = true }) {
  const shown = useTypeOut(msg.body ?? "", animate && !msg.isMine);
  if (msg.isMine) {
    const corners = `rounded-2xl ${first ? "" : "rounded-tr-md"} ${last ? "rounded-br-md" : "rounded-br-md"}`;
    return (
      <div className="flex justify-end">
        <div className={`max-w-[85%] ${corners} bg-red-600 px-3.5 py-2 text-sm leading-relaxed text-white whitespace-pre-wrap`}>{msg.body}</div>
      </div>
    );
  }
  const corners = `rounded-2xl ${first ? "rounded-tl-md" : "rounded-tl-md"} ${last ? "" : "rounded-bl-md"}`;
  const done = shown >= (msg.body ?? "").length;
  return (
    <div className="flex items-start gap-2">
      <div className="w-6 shrink-0">
        {first && (
          <div className="mt-1 flex h-6 w-6 items-center justify-center rounded-full bg-red-50">
            <Sparkles className="h-3 w-3 text-red-600" />
          </div>
        )}
      </div>
      <div className="max-w-[85%]">
        <div className={`${corners} bg-gray-100 px-3.5 py-2 text-sm leading-relaxed text-gray-900 whitespace-pre-wrap`}>
          {(msg.body ?? "").slice(0, shown)}
        </div>
        {msg.link && done && (
          <Link href={msg.link.href} className="mt-1.5 inline-flex items-center rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-gray-800">
            {msg.link.label}
          </Link>
        )}
        {msg.type === "proxy_answer" && last && done && (
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

export default function ProxyPanel({ listing, session, selectedLease = null, unitLabel = null, preview = false, active = true, tourIntentSignal = 0, showAbout = true, fill = false, inputSlot = null }) {
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
  // Tour times waiting in the input as a chip, and whether the picker is open.
  const [pickerOpen, setPickerOpen] = useState(false);
  const [tourSlots, setTourSlots] = useState(null);
  const [tourBusy, setTourBusy] = useState(false);
  // Messages that arrived in this session type themselves out.
  const [fresh, setFresh] = useState(() => new Set());
  const inputRef = useRef(null);
  const rootRef = useRef(null);
  const listRef = useRef(null);
  const selfId = useRef(Math.random().toString(36).slice(2));
  const signedIn = !!session?.user?.id;
  const started = messages.length > 0 || sending;
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

  // Pull new messages: on a timer while on screen, and at once when another
  // panel on this thread says something arrived.
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
        return [...m.filter((x) => !String(x.id).startsWith("temp-")), ...extra];
      });
    } catch {}
  }, [thread]);

  useEffect(() => {
    if (!active || !thread || sending) return;
    const t = setInterval(refresh, 15000);
    return () => clearInterval(t);
  }, [active, thread, sending, refresh]);

  useEffect(() => {
    if (!thread) return;
    const on = (e) => { if (e.detail?.threadId === thread.id && e.detail?.source !== selfId.current) refresh(); };
    window.addEventListener(SYNC_EVENT, on);
    return () => window.removeEventListener(SYNC_EVENT, on);
  }, [thread, refresh]);

  // "Ask Proxy" on the listing header puts the cursor in this chat.
  useEffect(() => {
    const on = (e) => { if (e.detail?.listingId === listingId) setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 250); };
    window.addEventListener("proxy:focus-input", on);
    return () => window.removeEventListener("proxy:focus-input", on);
  }, [listingId]);

  // A tour question opens the picker (from Proxy's reply, or the Messages header).
  useEffect(() => { if (tourIntentSignal && signedIn) setPickerOpen(true); }, [tourIntentSignal, signedIn]);

  // The chat to its newest message, and whatever scrolls around it (the
  // listing modal, or the page) all the way to the bottom.
  const scrollToEnd = useCallback((smooth = false) => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    let p = rootRef.current?.parentElement;
    while (p && p !== document.body) {
      const oy = getComputedStyle(p).overflowY;
      if ((oy === "auto" || oy === "scroll") && p.scrollHeight > p.clientHeight) break;
      p = p.parentElement;
    }
    const behavior = smooth ? "smooth" : "auto";
    if (p && p !== document.body) p.scrollTo({ top: p.scrollHeight, behavior });
    else if (!fill) window.scrollTo({ top: document.documentElement.scrollHeight, behavior });
  }, [fill]);

  // The conversation stays pinned to its newest message while an answer types out.
  useEffect(() => {
    const el = listRef.current;
    if (!el || !active) return;
    const obs = new MutationObserver(() => scrollToEnd(false));
    obs.observe(el, { childList: true, characterData: true, subtree: true });
    return () => obs.disconnect();
  }, [active, started, scrollToEnd]);

  // Opening the Contact tab glides to the bottom of the panel (the input),
  // after the modal's own jump to the tab strip has happened.
  useEffect(() => {
    if (!active || loading) return;
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    const t = setTimeout(() => scrollToEnd(true), 180);
    return () => clearTimeout(t);
  }, [active, loading, scrollToEnd]);

  const sendTour = useCallback(async (slots) => {
    const open = tour && ["requested", "proposed", "messaging"].includes(tour.status);
    const r = open
      ? await fetch(`/api/tours/${tour.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "update", slots }) })
      : await fetch("/api/tours", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ listingId, leaseId: leaseId ?? (choices.length === 1 ? choices[0].id : null), slots, proxyThreadId: thread?.id ?? null }) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data?.error || "Could not send your times.");
    setTour(data.tour);
  }, [tour, listingId, leaseId, choices, thread, setTour]);

  const send = useCallback(async () => {
    const text = input.trim();
    if ((!text && !tourSlots) || !thread || sending) return;
    setSending(true);
    setInput("");
    const slots = tourSlots;
    setTourSlots(null);
    const temp = text ? { id: `temp-${Date.now()}`, body: text, isMine: true, type: "text" } : null;
    if (temp) setMessages((m) => [...m, temp]);
    requestAnimationFrame(() => scrollToEnd(true));
    try {
      if (slots) {
        try { await sendTour(slots); } catch (err) { toast.error(err.message); setTourSlots(slots); }
      }
      if (text) {
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
        if (data.intent === "tour" && signedIn) setPickerOpen(true);
      }
      // Seen on the page: no email for this answer. Other panels catch up too.
      await refresh();
      announce(thread.id, selfId.current);
    } catch {
      if (temp) setMessages((m) => m.filter((x) => x.id !== temp.id));
      setInput(text);
      toast.error("Proxy could not answer just now.");
    } finally {
      setSending(false);
      requestAnimationFrame(() => scrollToEnd(true));
      inputRef.current?.focus();
    }
  }, [input, tourSlots, thread, sending, leaseId, signedIn, refresh, sendTour, scrollToEnd]);

  const cancelTour = useCallback(async () => {
    if (!tour) return;
    setTourBusy(true);
    try {
      const r = await fetch(`/api/tours/${tour.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "cancel" }) });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(data?.error || "Could not cancel."); return; }
      setTour(null);
      setPickerOpen(false);
      await refresh();
      announce(thread?.id, selfId.current);
    } finally {
      setTourBusy(false);
    }
  }, [tour, setTour, refresh, thread]);

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
    return <div className="py-4 text-sm text-gray-600">{unavailable}</div>;
  }

  const tourAllowed = !testMode && choices.length > 0;
  const sideOf = (m) => (m.isMine ? "me" : "proxy");

  const inputBar = signInNeeded ? (
        <div className="text-sm text-red-700">
          Sign in to keep asking.{" "}
          <button type="button" onClick={() => signIn()} className="font-semibold underline">Sign in</button>
        </div>
      ) : (
        <div className="relative">
          {pickerOpen && signedIn && tourAllowed && (
            <div className="absolute bottom-full right-0 z-[100] mb-2 w-full max-w-md">
              <TourPicker
                tour={tour && ["requested", "proposed", "messaging", "confirmed"].includes(tour.status) ? tour : null}
                initial={tourSlots}
                busy={tourBusy}
                onAdd={(slots) => { setTourSlots(slots); setPickerOpen(false); inputRef.current?.focus(); }}
                onCancelTour={cancelTour}
                onClose={() => setPickerOpen(false)}
              />
            </div>
          )}
          <form onSubmit={(e) => { e.preventDefault(); send(); }} className="flex items-end gap-2">
            <div className="flex min-h-11 flex-1 flex-col justify-center rounded-xl border border-gray-300 bg-white px-3 py-1.5 focus-within:border-gray-400">
              {tourSlots && (
                <span className="mb-1 inline-flex w-fit items-center gap-1 rounded-full bg-gray-900 px-2.5 py-0.5 text-xs font-semibold text-white">
                  <CalendarDays className="h-3 w-3" />
                  <button type="button" onClick={() => setPickerOpen(true)} className="hover:underline">{availabilitySummary(tourSlots)}</button>
                  <button type="button" onClick={() => setTourSlots(null)} aria-label="Remove availability" className="ml-0.5 opacity-70 hover:opacity-100"><X className="h-3 w-3" /></button>
                </span>
              )}
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  e.target.style.height = "auto";
                  e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
                }}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                rows={1}
                maxLength={2000}
                placeholder={tourSlots ? "Add a note, or just send" : started ? "Ask a follow-up" : "Ask about fees, pets, parking, lease terms, move-in dates..."}
                disabled={loading || sending || !thread}
                className="w-full resize-none border-0 bg-transparent p-0 py-1 text-base leading-6 focus:outline-none focus:ring-0"
              />
            </div>
            {tourAllowed && (
              <button
                type="button"
                onClick={() => (signedIn ? setPickerOpen((o) => !o) : signIn())}
                aria-label={signedIn ? "Pick tour times" : "Sign in to request a tour"}
                title={signedIn ? "Request a tour" : "Sign in to request a tour"}
                className={`inline-flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-xl border px-3 text-sm font-semibold ${pickerOpen || tourSlots ? "border-gray-900 bg-gray-900 text-white" : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"}`}
              >
                <CalendarDays className="h-5 w-5" />
                Tour
              </button>
            )}
            <button type="submit" disabled={loading || sending || (!input.trim() && !tourSlots)} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-red-600 text-white disabled:opacity-40">
              <Send className="h-5 w-5" />
            </button>
          </form>
        </div>
      );

  return (
    <div ref={rootRef} className={`flex flex-col gap-3 ${fill ? "h-full min-h-0" : ""}`}>
      {testMode && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Test mode: you are trying Proxy on {preview ? "your own" : "this"} listing. Answers are real; nothing is logged, counted or sent to a landlord.
        </div>
      )}

      {showAbout && (
        <p className="text-sm text-gray-700">
          Asking about <span className="font-semibold text-gray-900">{aboutLabel}</span>
        </p>
      )}

      {loading && <ChatSkeleton rows={3} />}
      {started && (
        <div ref={listRef} className={`flex flex-col overflow-y-auto ${fill ? "min-h-0 flex-1" : "max-h-[480px]"}`}>
          {messages.map((m, i) => {
            const first = i === 0 || sideOf(messages[i - 1]) !== sideOf(m);
            const last = i === messages.length - 1 || sideOf(messages[i + 1]) !== sideOf(m);
            return (
              <div key={m.id} className={first ? (i === 0 ? "" : "mt-3") : "mt-0.5"}>
                <Bubble msg={m} onReport={report} animate={fresh.has(m.id)} first={first} last={last} />
              </div>
            );
          })}
          {sending && <div className="mt-3"><TypingBubble /></div>}
        </div>
      )}

      {inputSlot ? (active ? createPortal(inputBar, inputSlot) : null) : <div className="shrink-0">{inputBar}</div>}
    </div>
  );
}
