"use client";

/*
 * The landlord's Proxy chat for one listing (Wyatt, 2026-10-27, round 6).
 * Proxy's messages on the left: each question a student asked (never who),
 * the student's replies to the landlord's follow-ups, and tour requests with
 * the student's availability. The landlord's own replies on the right.
 *
 * One reply box at the bottom, aimed at an open question: the oldest one by
 * default, or whichever "Reply" was clicked. Proxy works out whether the
 * reply answers it, asks the student something, or both.
 *
 * A tour request carries its own controls: pick one of the student's days
 * and type a start time (checked against their window), or write to the
 * student when none of it works, which opens the direct chat.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import toast from "react-hot-toast";
import { Send, Sparkles, CalendarDays } from "lucide-react";
import ChatSkeleton from "@/components/chat/ChatSkeleton";

const when = (iso) => (iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "");

function ProxyBubble({ children, first = true, footer = null }) {
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
        <div className="rounded-2xl rounded-tl-md bg-gray-100 px-3.5 py-2 text-sm leading-relaxed text-gray-900 whitespace-pre-wrap">{children}</div>
        {footer}
      </div>
    </div>
  );
}

function MyBubble({ children, note = null }) {
  return (
    <div className="flex flex-col items-end">
      <div className="max-w-[85%] rounded-2xl rounded-br-md bg-red-600 px-3.5 py-2 text-sm leading-relaxed text-white whitespace-pre-wrap">{children}</div>
      {note && <span className="mt-0.5 text-[11px] text-gray-400">{note}</span>}
    </div>
  );
}

function TourControls({ tour, viewAsId, onDone }) {
  const days = tour.availability ?? [];
  const [day, setDay] = useState(days[0]?.key ?? "");
  const [time, setTime] = useState("");
  const [writing, setWriting] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const qs = viewAsId ? `?viewAs=${encodeURIComponent(viewAsId)}` : "";
  const act = async (payload) => {
    setBusy(true);
    try {
      const r = await fetch(`/api/landlord/tours/${tour.id}${qs}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(data?.error || "Could not update the tour."); return; }
      toast.success(payload.action === "confirm" ? "Tour confirmed. The student has been told." : payload.action === "message" ? "Sent. The chat with the student is open in your Messages." : "Tour cancelled.");
      onDone();
    } finally { setBusy(false); }
  };
  const chosen = days.find((d) => d.key === day);
  return (
    <div className="mt-2 space-y-2 rounded-xl border border-gray-200 bg-white p-3 text-sm">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-gray-600">
          Day
          <select value={day} onChange={(e) => setDay(e.target.value)} className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm text-gray-900">
            {days.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-gray-600">
          Start time
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} step={300} className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm text-gray-900" />
        </label>
        <button type="button" disabled={busy || !day || !time} onClick={() => act({ action: "confirm", day, time })} className="h-[34px] rounded-lg bg-red-600 px-4 text-sm font-semibold text-white disabled:opacity-50">
          Confirm tour
        </button>
      </div>
      {chosen && <p className="text-[11px] text-gray-500">{(tour.availabilityText ?? "").split("\n").find((l) => l.startsWith(chosen.label))}. Pick a start inside a window, at least 10 minutes before it ends.</p>}
      {writing ? (
        <div className="space-y-2">
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder="None of those work? Write to them directly, for example the times you can do." className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm" />
          <div className="flex gap-2">
            <button type="button" disabled={busy || !text.trim()} onClick={() => act({ action: "message", body: text.trim() })} className="rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">Send to the student</button>
            <button type="button" onClick={() => setWriting(false)} className="text-xs text-gray-500 hover:text-gray-800">Back</button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-3">
          <button type="button" onClick={() => setWriting(true)} className="text-xs font-semibold text-gray-800 underline">None of these work? Message the student</button>
          <button type="button" disabled={busy} onClick={() => act({ action: "cancel" })} className="text-xs text-gray-500 hover:text-gray-800">Decline the tour</button>
        </div>
      )}
    </div>
  );
}

export function TourItem({ tour, viewAsId, onDone }) {
  const head = `${tour.studentName} wants to tour${tour.lease ? ` ${tour.lease.unit}${tour.lease.rent ? ` at $${Number(tour.lease.rent).toLocaleString("en-US")}/mo` : ""}` : ""}. They're available:\n${tour.availabilityText || "(no times left)"}`;
  const openChat = tour.threadId ? <Link href={`/?messages=1&thread=${tour.threadId}`} className="mt-1.5 inline-flex rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white">Open the chat with {tour.studentName.split(" ")[0]}</Link> : null;
  return (
    <div className="space-y-1">
      <ProxyBubble footer={tour.status === "requested" || tour.status === "proposed" ? <TourControls tour={tour} viewAsId={viewAsId} onDone={onDone} /> : null}>
        <span className="mb-1 inline-flex items-center gap-1 text-xs font-semibold text-gray-600"><CalendarDays className="h-3 w-3" /> Tour request</span>
        {"\n"}{head}
      </ProxyBubble>
      {tour.status === "confirmed" && <ProxyBubble first={false} footer={openChat}>Confirmed for {tour.confirmedText}. I let them know.</ProxyBubble>}
      {tour.status === "messaging" && <ProxyBubble first={false} footer={openChat}>You&apos;re talking with them directly about a time.</ProxyBubble>}
      {tour.status === "cancelled" && <ProxyBubble first={false}>{tour.cancelledByMe ? "You declined this tour." : "They cancelled this request."}</ProxyBubble>}
      {tour.status === "expired" && <ProxyBubble first={false}>Their times passed without a confirmation.</ProxyBubble>}
    </div>
  );
}

function QuestionItem({ item, targeted, onTarget }) {
  return (
    <div className="space-y-1">
      <ProxyBubble footer={item.status === "open" ? (
        <button type="button" onClick={() => onTarget(item.id)} className={`mt-0.5 text-[11px] font-semibold ${targeted ? "text-red-600" : "text-gray-500 hover:text-gray-800"}`}>
          {targeted ? "Replying to this" : "Reply"}
        </button>
      ) : null}>
        {`A student asked${item.lease ? ` about ${item.lease}` : ""}${item.askedCount > 1 ? ` (${item.askedCount} students so far)` : ""}:\n${item.question}`}
      </ProxyBubble>
      {item.messages.map((m, i) => (m.sender === "landlord"
        ? <MyBubble key={i} note={m.via === "email" ? "by email" : null}>{m.body}</MyBubble>
        : <ProxyBubble key={i} first={false}>{`The student replied: ${m.body}`}</ProxyBubble>))}
      {item.status === "open" && item.pendingClarifier && <p className="pl-8 text-[11px] text-gray-400">Waiting on the student&apos;s reply.</p>}
      {item.status === "answered" && <p className="pl-8 text-[11px] text-gray-400">Answered {when(item.answeredAt)} · saved to what Proxy knows</p>}
    </div>
  );
}

export default function LandlordProxyChat({ listingId, viewAsId = null, maxHeight = "max-h-[560px]", onChanged = null }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [target, setTarget] = useState(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef(null);
  const qs = viewAsId ? `&viewAs=${encodeURIComponent(viewAsId)}` : "";

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/landlord/proxy-chat?listingId=${encodeURIComponent(listingId)}${qs}`);
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error || "Could not load");
      setData(d);
      setError(null);
    } catch (err) { setError(err.message); }
  }, [listingId, qs]);

  useEffect(() => { setData(null); setTarget(null); load(); }, [load]);
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === "visible") load(); }, 20000);
    return () => clearInterval(t);
  }, [load]);

  const open = useMemo(() => (data?.items ?? []).filter((i) => i.kind === "question" && i.status === "open"), [data]);
  const aimed = open.find((q) => q.id === target) ?? open.find((q) => !q.pendingClarifier) ?? open[0] ?? null;

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [data]);

  const send = async () => {
    const body = text.trim();
    if (!body || !aimed || sending) return;
    setSending(true);
    try {
      const v = viewAsId ? `?viewAs=${encodeURIComponent(viewAsId)}` : "";
      const r = await fetch(`/api/landlord/questions/${aimed.id}${v}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(d?.error || "Could not send that."); return; }
      if (d.screened) toast("Contact details were removed before Proxy passed it on.", { icon: "ℹ️" });
      setText("");
      setTarget(null);
      await load();
      onChanged?.();
    } finally { setSending(false); }
  };

  if (error) return <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  if (!data) return <ChatSkeleton rows={4} />;

  return (
    <div className="flex flex-col gap-3">
      <div ref={listRef} className={`flex flex-col gap-4 overflow-y-auto ${maxHeight}`}>
        {data.items.length === 0 && (
          <p className="py-6 text-center text-sm text-gray-500">No questions yet. When a student asks something Proxy can&apos;t answer, or wants to tour, it shows up here and in your email.</p>
        )}
        {data.items.map((i) => (i.kind === "tour"
          ? <TourItem key={`t${i.id}`} tour={i.tour} viewAsId={viewAsId} onDone={() => { load(); onChanged?.(); }} />
          : <QuestionItem key={`q${i.id}`} item={i} targeted={aimed?.id === i.id} onTarget={setTarget} />))}
      </div>
      <form onSubmit={(e) => { e.preventDefault(); send(); }} className="flex items-end gap-2 border-t border-gray-200 pt-3">
        <div className="flex min-h-11 flex-1 flex-col justify-center rounded-xl border border-gray-300 bg-white px-3 py-1.5">
          {aimed && <span className="mb-0.5 truncate text-[11px] text-gray-500">Replying to: {aimed.question}</span>}
          <textarea
            value={text}
            onChange={(e) => { setText(e.target.value); e.target.style.height = "auto"; e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`; }}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            rows={1}
            disabled={!aimed || sending}
            placeholder={aimed ? "Answer, or ask the student something first if you need a detail" : "Nothing waiting on you right now"}
            className="w-full resize-none border-0 bg-transparent p-0 py-1 text-base leading-6 focus:outline-none focus:ring-0"
          />
        </div>
        <button type="submit" disabled={!aimed || sending || !text.trim()} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-red-600 text-white disabled:opacity-40">
          <Send className="h-5 w-5" />
        </button>
      </form>
    </div>
  );
}
