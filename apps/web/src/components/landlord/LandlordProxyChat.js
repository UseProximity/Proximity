"use client";

/*
 * The landlord's one chat for a listing (Wyatt, 2026-10-27, round 6; one
 * all-purpose thread since round 7). Proxy's messages on the left: each
 * question a student asked (never who), the student's replies to the
 * landlord's follow-ups, tour requests with the student's availability, and
 * the listing agent's replies. The landlord's own messages on the right.
 *
 * One box. Proxy guesses whether a message answers an open question or is
 * for the agent (an update, a change, a question about the listing), and
 * the guess shows under the message for a few seconds with Undo and a
 * switch before it is sent. "Reply" under a question aims the box at it
 * without a guess. Changes the agent proposes are confirmed in place.
 *
 * A tour request carries its own controls: pick one of the student's days
 * and type a start time (checked against their window), or write to the
 * student when none of it works, which opens the direct chat.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import toast from "react-hot-toast";
import { Send, Sparkles, CalendarDays, X } from "lucide-react";
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

const HOLD_MS = 5000;
const INTRO = "Hi, I'm this listing's agent. Students' questions and tour requests show up here, and you can answer them right in this box. You can also tell me something new (\"parking is $75 a month\"), change what students see (\"lower the 2-bed to $1,450\"), or ask what I know. I check with you before changing anything.";

function QuestionItem({ item, targeted, onTarget }) {
  return (
    <ProxyBubble footer={item.status === "open" ? (
      <button type="button" onClick={() => onTarget(targeted ? null : item.id)} className={`mt-0.5 text-[11px] font-semibold ${targeted ? "text-red-600" : "text-gray-500 hover:text-gray-800"}`}>
        {targeted ? "Replying to this" : "Reply"}
      </button>
    ) : null}>
      {`A student asked${item.lease ? ` about ${item.lease}` : ""}${item.askedCount > 1 ? ` (${item.askedCount} students so far)` : ""}:\n${item.question}`}
    </ProxyBubble>
  );
}

function Proposal({ item, busy, onDecide }) {
  const p = item.proposal;
  return (
    <div className="mt-2 rounded-xl border border-gray-200 bg-white p-3 text-sm">
      <p className="mb-2 font-semibold text-gray-900">Confirm these changes</p>
      <ul className="mb-3 space-y-1">
        {(p.coreChanges ?? []).map((c, i) => <li key={`c${i}`} className={c.allowed === false || c.error ? "text-red-700" : "text-gray-800"}>{c.refLabel ?? c.ref}: {c.fieldLabel ?? c.field} to <strong>{String(c.value)}</strong>{c.error ? ` (${c.error})` : ""}</li>)}
        {(p.facts ?? []).map((f, i) => <li key={`f${i}`} className={f.allowed === false ? "text-red-700" : "text-gray-800"}>Save: {f.summary}</li>)}
        {(p.retireKeys ?? []).map((k) => <li key={k} className="text-gray-800">Remove: {k}</li>)}
      </ul>
      <div className="flex gap-2">
        <button type="button" disabled={busy} onClick={() => onDecide(item.id, true)} className="rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">Confirm</button>
        <button type="button" disabled={busy} onClick={() => onDecide(item.id, false)} className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-700">Cancel</button>
      </div>
    </div>
  );
}

// `fill` makes the chat take its parent's height, with the box pinned to the bottom.
export default function LandlordProxyChat({ listingId, viewAsId = null, maxHeight = "max-h-[560px]", fill = false, onChanged = null }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [target, setTarget] = useState(null);
  const [text, setText] = useState("");
  // A message waiting out its Undo window: { text, questionId, question, left }
  const [pending, setPending] = useState(null);
  const [working, setWorking] = useState(false);
  const listRef = useRef(null);
  const inputRef = useRef(null);
  const timerRef = useRef(null);
  const qs = viewAsId ? `&viewAs=${encodeURIComponent(viewAsId)}` : "";
  const v = viewAsId ? `?viewAs=${encodeURIComponent(viewAsId)}` : "";

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
  useEffect(() => () => clearInterval(timerRef.current), []);

  const post = useCallback(async (payload) => {
    const r = await fetch(`/api/landlord/proxy-chat${v}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ listingId, ...payload }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d?.error || "Could not send that.");
    return d;
  }, [listingId, v]);

  const open = useMemo(() => (data?.items ?? []).filter((i) => i.kind === "question" && i.status === "open"), [data]);
  const aimed = open.find((q) => q.id === target) ?? null;

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [data, pending, working]);

  const commit = useCallback(async (p) => {
    clearInterval(timerRef.current);
    setPending(null);
    setWorking(true);
    try {
      const d = await post({ action: "send", text: p.text, questionId: p.questionId });
      if (d.screened) toast("Contact details were removed before Proxy passed it on.", { icon: "ℹ️" });
      await load();
      onChanged?.();
    } catch (err) {
      toast.error(err.message);
      setText(p.text);
    } finally { setWorking(false); }
  }, [post, load, onChanged]);

  const hold = useCallback((p) => {
    clearInterval(timerRef.current);
    const until = Date.now() + HOLD_MS;
    setPending({ ...p, left: Math.ceil(HOLD_MS / 1000) });
    timerRef.current = setInterval(() => {
      const left = Math.ceil((until - Date.now()) / 1000);
      if (left <= 0) { clearInterval(timerRef.current); commit(p); }
      else setPending((cur) => (cur ? { ...cur, left } : cur));
    }, 250);
  }, [commit]);

  const send = async () => {
    const body = text.trim();
    if (!body || pending || working) return;
    setText("");
    if (inputRef.current) inputRef.current.style.height = "auto";
    if (aimed) { setTarget(null); hold({ text: body, questionId: aimed.id, question: aimed.question }); return; }
    if (!open.length) { commit({ text: body, questionId: null }); return; }
    setWorking(true);
    let guess = { questionId: null };
    try { guess = await post({ action: "route", text: body }); } catch { /* falls back to the agent */ }
    setWorking(false);
    hold({ text: body, questionId: guess.questionId ?? null, question: guess.question ?? null });
  };

  const undo = () => {
    clearInterval(timerRef.current);
    if (pending) setText(pending.text);
    setPending(null);
    setTimeout(() => inputRef.current?.focus(), 0);
  };
  const flip = () => {
    if (!pending) return;
    if (pending.questionId) hold({ text: pending.text, questionId: null, question: null });
    else if (open.length === 1) hold({ text: pending.text, questionId: open[0].id, question: open[0].question });
    else { undo(); toast("Click Reply under the question this answers, then send.", { icon: "ℹ️" }); }
  };

  const decide = async (messageId, confirm) => {
    setWorking(true);
    try {
      await post({ action: "decide", messageId, confirm });
      await load();
      onChanged?.();
    } catch (err) { toast.error(err.message); } finally { setWorking(false); }
  };

  if (error) return <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  if (!data) return <ChatSkeleton rows={4} />;

  const items = data.items;
  const sideOf = (i) => (i.kind === "agent" ? (i.sender === "landlord" ? "me" : "proxy") : i.kind === "reply" ? (i.sender === "landlord" ? "me" : "proxy") : "proxy");

  return (
    <div className={`flex flex-col gap-3 ${fill ? "h-full min-h-0" : ""}`}>
      <div ref={listRef} className={`flex flex-col overflow-y-auto ${fill ? "min-h-0 flex-1" : maxHeight}`}>
        {!items.some((i) => i.kind === "agent") && <div className="mb-3"><ProxyBubble>{INTRO}</ProxyBubble></div>}
        {items.map((i, n) => {
          const first = n === 0 || sideOf(items[n - 1]) !== sideOf(i);
          const gap = n === 0 ? "" : first ? "mt-3" : "mt-1";
          if (i.kind === "tour") return <div key={`t${i.id}`} className={gap}><TourItem tour={i.tour} viewAsId={viewAsId} onDone={() => { load(); onChanged?.(); }} /></div>;
          if (i.kind === "question") return <div key={`q${i.id}`} className={gap}><QuestionItem item={i} targeted={target === i.id} onTarget={setTarget} /></div>;
          if (i.kind === "reply") {
            return (
              <div key={`r${i.id}`} className={gap}>
                {i.sender === "landlord"
                  ? <MyBubble note={[i.via === "email" ? "by email" : null, i.note].filter(Boolean).join(" · ") || null}>{i.body}</MyBubble>
                  : <ProxyBubble first={first}>{`The student replied about "${i.question}": ${i.body}`}</ProxyBubble>}
              </div>
            );
          }
          return (
            <div key={`a${i.id}`} className={gap}>
              {i.sender === "landlord"
                ? <MyBubble>{i.body}</MyBubble>
                : <ProxyBubble first={first} footer={i.proposal ? <Proposal item={i} busy={working} onDecide={decide} /> : null}>{i.body}</ProxyBubble>}
            </div>
          );
        })}
        {pending && (
          <div className="mt-3">
            <MyBubble>{pending.text}</MyBubble>
            <p className="mt-1 text-right text-[11px] text-gray-500">
              {pending.questionId ? `Sending to the student who asked "${pending.question}"` : "Sending to your agent, not to a student"} in {pending.left}s ·{" "}
              <button type="button" onClick={undo} className="font-semibold text-gray-800 underline">Undo</button>
              {(pending.questionId || open.length > 0) && (
                <>
                  {" · "}
                  <button type="button" onClick={flip} className="font-semibold text-gray-800 underline">{pending.questionId ? "It's for my agent" : "It answers a question"}</button>
                </>
              )}
              {" · "}
              <button type="button" onClick={() => commit(pending)} className="font-semibold text-red-600 underline">Send now</button>
            </p>
          </div>
        )}
        {working && <p className="mt-2 pl-8 text-xs text-gray-400">Proxy is working on it...</p>}
      </div>
      <form onSubmit={(e) => { e.preventDefault(); send(); }} className="flex shrink-0 items-end gap-2">
        <div className="flex min-h-11 flex-1 flex-col justify-center rounded-xl border border-gray-300 bg-white px-3 py-1.5 focus-within:border-gray-400">
          {aimed && (
            <span className="mb-0.5 flex items-center gap-1 text-[11px] text-gray-500">
              <span className="truncate">Replying to: {aimed.question}</span>
              <button type="button" onClick={() => setTarget(null)} aria-label="Stop replying to this question" className="shrink-0 hover:text-gray-800"><X className="h-3 w-3" /></button>
            </span>
          )}
          <textarea
            ref={inputRef}
            value={text}
            onChange={(e) => { setText(e.target.value); e.target.style.height = "auto"; e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`; }}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            rows={1}
            disabled={!!pending}
            placeholder={aimed ? "Answer, or ask the student for a detail first" : open.length ? "Answer a question, or tell your agent something" : "Tell your agent something, change a detail, or ask what it knows"}
            className="w-full resize-none border-0 bg-transparent p-0 py-1 text-base leading-6 focus:outline-none focus:ring-0"
          />
        </div>
        <button type="submit" disabled={!!pending || working || !text.trim()} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-red-600 text-white disabled:opacity-40">
          <Send className="h-5 w-5" />
        </button>
      </form>
    </div>
  );
}
