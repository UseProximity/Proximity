"use client";

/*
 * The landlord's one chat for a listing (Wyatt, 2026-10-27, round 6; one
 * all-purpose thread since round 7; cards since 2026-10-29).
 *
 * Every question a student asked is one card holding its whole
 * back-and-forth: the question (never who asked; with several students they
 * read "One student" and "Another student"), the landlord's replies with a
 * line on what Proxy did with each, the students' replies and follow-ups.
 * Every tour request is a card too. A card sits at its latest activity, says
 * whether it needs the landlord, and folds to one line once it is settled.
 * The listing agent's talk runs between the cards as plain bubbles.
 *
 * One box, pinned at the bottom. "Reply" on a card aims the box at it (a
 * small Undo, then it goes). Otherwise Proxy guesses: when it thinks the
 * message is for a question it asks the landlord to confirm with a click,
 * when it is unsure it asks which question, and only a sure "this is for
 * Proxy" goes straight to the agent. A pill at the top counts the cards that
 * need the landlord and jumps between them.
 *
 * A tour card carries its own controls: one of the student's days and a
 * start time from a list of 15-minute slots inside their windows (at least
 * 10 minutes before a window ends), or decline. Its Reply writes to the
 * student in the direct chat.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import toast from "react-hot-toast";
import { Send, Sparkles, CalendarDays, X, MessageCircleQuestion, ChevronDown, ChevronUp, CheckCircle2, ArrowDown } from "lucide-react";
import ChatSkeleton from "@/components/chat/ChatSkeleton";
import { chicagoToUtc } from "@/lib/agents/tourTime";

function ProxyAvatar({ show = true }) {
  return (
    <div className="w-6 shrink-0">
      {show && (
        <div className="mt-1 flex h-6 w-6 items-center justify-center rounded-full bg-red-50">
          <Sparkles className="h-3 w-3 text-red-600" />
        </div>
      )}
    </div>
  );
}

function ProxyBubble({ children, first = true, footer = null }) {
  return (
    <div className="flex items-start gap-2">
      <ProxyAvatar show={first} />
      <div className="max-w-[85%]">
        <div className="rounded-2xl rounded-tl-md bg-gray-100 px-3.5 py-2 text-sm leading-relaxed text-gray-900 whitespace-pre-wrap">{children}</div>
        {footer}
      </div>
    </div>
  );
}

/* Proxy typing: three bouncing dots in a Proxy bubble. */
function TypingBubble({ first = true }) {
  return (
    <ProxyBubble first={first}>
      <span className="flex items-center gap-1 py-1">
        {[0, 150, 300].map((d) => <span key={d} className={`h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400 ${d === 150 ? "[animation-delay:150ms]" : d === 300 ? "[animation-delay:300ms]" : ""}`} />)}
      </span>
    </ProxyBubble>
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

/* ---- tour times --------------------------------------------------------- */

const clock = (min) => {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};

/* Start times on one of the student's days: every 15 minutes, still ahead, at least 10 before a window ends. */
function startTimes(day) {
  const out = new Set();
  for (const r of day?.ranges ?? []) {
    for (let t = r.startH * 60; t <= r.endH * 60 - 10; t += 15) out.add(t);
  }
  return [...out].sort((a, b) => a - b)
    .filter((t) => chicagoToUtc(day.y, day.m, day.d, Math.floor(t / 60)).getTime() + (t % 60) * 60000 > Date.now())
    .map((t) => ({ value: `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`, label: clock(t) }));
}

function TourControls({ tour, viewAsId, onDone, onReply = null }) {
  const days = useMemo(() => (tour.availability ?? []).map((d) => ({ ...d, times: startTimes(d) })).filter((d) => d.times.length), [tour.availability]);
  const [day, setDay] = useState(days[0]?.key ?? "");
  const chosen = days.find((d) => d.key === day) ?? null;
  const [time, setTime] = useState(chosen?.times[0]?.value ?? "");
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
  const pickDay = (key) => {
    setDay(key);
    setTime(days.find((d) => d.key === key)?.times[0]?.value ?? "");
  };
  const select = "rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900";
  return (
    <div className="space-y-2 text-sm">
      {days.length ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs text-gray-600">
            Day
            <select value={day} onChange={(e) => pickDay(e.target.value)} className={select}>
              {days.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-gray-600">
            Start time
            <select value={time} onChange={(e) => setTime(e.target.value)} className={select}>
              {(chosen?.times ?? []).map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </label>
          <button type="button" disabled={busy || !day || !time} onClick={() => act({ action: "confirm", day, time })} className="h-[34px] rounded-lg bg-red-600 px-4 text-sm font-semibold text-white disabled:opacity-50">
            Confirm tour
          </button>
        </div>
      ) : (
        <p className="text-xs text-gray-500">Their times have all passed.</p>
      )}
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
          {/* In the chat, the card's Reply does this. */}
          {!onReply && <button type="button" onClick={() => setWriting(true)} className="text-xs font-semibold text-gray-800 underline">None of these work? Message the student</button>}
          <button type="button" disabled={busy} onClick={() => act({ action: "cancel" })} className="text-xs text-gray-500 hover:text-gray-800">Decline the tour</button>
        </div>
      )}
    </div>
  );
}

/* ---- cards -------------------------------------------------------------- */

const STATE = {
  needs_you: { label: "Needs you", className: "bg-red-600 text-white" },
  waiting: { label: "Waiting on the student", className: "bg-white text-gray-600" },
  answered: { label: "Answered", className: "bg-white text-green-700" },
  confirmed: { label: "Confirmed", className: "bg-white text-green-700" },
  closed: { label: "Closed", className: "bg-white text-gray-500" },
};

function Entry({ e }) {
  if (e.from === "you") {
    return (
      <div className="border-t border-gray-200 pt-2">
        <p><span className="font-semibold">You:</span> {e.body}</p>
        {e.note && <p className="mt-0.5 text-xs text-gray-500">{e.note}</p>}
      </div>
    );
  }
  return (
    <div className="border-t border-gray-200 pt-2">
      <p><span className="font-semibold">{e.label}{e.followup ? " followed up" : ""}:</span> {e.body}</p>
    </div>
  );
}

function Card({ id, icon, title, state, stateLabel = null, folded, foldedText, onToggle, canFold, replying, onReply, highlight, children }) {
  const s = STATE[state] ?? STATE.closed;
  return (
    <div id={id} className="flex items-start gap-2">
      <ProxyAvatar />
      <div className={`w-full max-w-[85%] rounded-2xl rounded-tl-md bg-gray-100 px-3.5 py-2.5 text-sm leading-relaxed text-gray-900 transition-shadow ${highlight ? "ring-2 ring-red-300" : ""} ${replying ? "ring-2 ring-red-500" : ""}`}>
        <div className="flex items-center gap-2">
          <span className="inline-flex min-w-0 flex-1 items-center gap-1.5 text-xs font-semibold text-gray-600">{icon}<span className="truncate">{title}</span></span>
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${s.className}`}>{stateLabel ?? s.label}</span>
          {canFold && (
            <button type="button" onClick={onToggle} aria-label={folded ? "Show the whole conversation" : "Fold this card"} className="shrink-0 text-gray-400 hover:text-gray-700">
              {folded ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
            </button>
          )}
        </div>
        {folded ? (
          <button type="button" onClick={onToggle} className="mt-1 block w-full truncate text-left text-gray-700 hover:text-gray-900">{foldedText}</button>
        ) : (
          <div className="mt-1.5 space-y-2 whitespace-pre-wrap">
            {children}
            {onReply && (
              <button type="button" onClick={onReply} className={`text-xs font-semibold ${replying ? "text-red-600" : "text-gray-500 hover:text-gray-800"}`}>
                {replying ? "Replying to this" : "Reply"}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function QuestionCard({ item, extra, folded, onToggle, canFold, replying, onReply, highlight }) {
  const several = (item.askedCount ?? 1) > 1;
  const lastYou = [...item.exchange].reverse().find((e) => e.from === "you");
  return (
    <Card
      id={`card-question-${item.id}`}
      icon={<MessageCircleQuestion className="h-3.5 w-3.5" />}
      title={several ? `${item.askedCount} students asked` : "A student asked"}
      state={item.state}
      folded={folded}
      foldedText={<><CheckCircle2 className="mr-1 inline h-3.5 w-3.5 text-green-600" />{item.question}{lastYou ? <span className="text-gray-500"> · {lastYou.body}</span> : null}</>}
      onToggle={onToggle}
      canFold={canFold}
      replying={replying}
      onReply={onReply}
      highlight={highlight}
    >
      <p className="font-medium">{item.question}</p>
      {[...item.exchange, ...extra].map((e) => <Entry key={e.id} e={e} />)}
    </Card>
  );
}

function TourCard({ item, extra, viewAsId, onDone, folded, onToggle, canFold, replying, onReply, highlight }) {
  const t = item.tour;
  const first = t.studentName?.split(" ")[0] || "them";
  const unit = t.lease ? ` ${t.lease.unit}${t.lease.rent ? ` at $${Number(t.lease.rent).toLocaleString("en-US")}/mo` : ""}` : "";
  const openChat = t.threadId ? <Link href={`/?messages=1&thread=${t.threadId}`} className="inline-flex rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white">Open the chat with {first}</Link> : null;
  const label = t.status === "confirmed" ? "Confirmed" : t.status === "messaging" ? "Talking directly" : t.status === "cancelled" ? (t.cancelledByMe ? "Declined" : "Cancelled") : t.status === "expired" ? "Expired" : null;
  return (
    <Card
      id={`card-tour-${item.id}`}
      icon={<CalendarDays className="h-3.5 w-3.5" />}
      title={`Tour request · ${t.studentName}`}
      state={item.state}
      stateLabel={label}
      folded={folded}
      foldedText={t.status === "confirmed" ? `${t.studentName} · ${t.confirmedText}` : `${t.studentName} wanted to tour${unit}`}
      onToggle={onToggle}
      canFold={canFold}
      replying={replying}
      onReply={onReply}
      highlight={highlight}
    >
      <p>{`${t.studentName} wants to tour${unit}. They're available:\n${t.availabilityText || "(no times left)"}`}</p>
      {t.status === "messaging" && <p>You&apos;re talking with them directly. Confirm a time here once you agree on one.</p>}
      {["requested", "proposed", "messaging"].includes(t.status) && <TourControls tour={t} viewAsId={viewAsId} onDone={onDone} onReply={onReply} />}
      {t.status === "confirmed" && <p>Confirmed for {t.confirmedText}. I let them know.</p>}
      {t.status === "cancelled" && <p>{t.cancelledByMe ? "You declined this tour." : "They cancelled this request."}</p>}
      {t.status === "expired" && <p>Their times passed without a confirmation.</p>}
      {[...item.exchange, ...extra].map((e) => <Entry key={e.id} e={e} />)}
      {openChat && <div>{openChat}</div>}
    </Card>
  );
}

/* The Tours tab shows the same card on its own, writing to the student in place. */
export function TourItem({ tour, viewAsId, onDone }) {
  const state = tour.status === "requested" || tour.status === "proposed" ? "needs_you" : tour.status === "messaging" ? "waiting" : tour.status === "confirmed" ? "confirmed" : "closed";
  return <TourCard item={{ id: tour.id, tour, state, exchange: [] }} extra={[]} viewAsId={viewAsId} onDone={onDone} folded={false} canFold={false} />;
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

/* ---- the chat ----------------------------------------------------------- */

const HOLD_MS = 5000;
const INTRO = "Hi, I'm this listing's agent. Students' questions and tour requests show up here as cards: press Reply on one to answer it. You can also tell me something new (\"parking is $75 a month\"), change what students see (\"lower the 2-bed to $1,450\"), or ask what I know. I check with you before changing anything.";

const isCard = (i) => i.kind === "question" || i.kind === "tour";
const sideOf = (i) => (i.kind === "agent" && i.sender === "landlord" ? "me" : "proxy");
const cardKey = (i) => `${i.kind}:${i.id}`;
// News from the other side: a new item, or a card with a new student line or a new status.
const newsOf = (i) => (isCard(i) ? `${cardKey(i)}:${i.exchange.filter((e) => e.from !== "you").length}:${i.kind === "tour" ? i.tour.status : ""}` : `${i.kind}:${i.id}`);
const settled = (i) => ["answered", "confirmed", "closed"].includes(i.state);
const labelOf = (i) => (i.kind === "tour" ? `${i.tour.studentName}'s tour request` : i.question);
const aimsAt = (p, i) => !!p && ((i.kind === "question" && p.questionId === i.id) || (i.kind === "tour" && p.tourId === i.id));

// `fill` makes the chat take its parent's height, with the box pinned to the bottom.
export default function LandlordProxyChat({ listingId, viewAsId = null, maxHeight = "max-h-[560px]", fill = false, onChanged = null }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  // The card the box is aimed at: { kind, id, label }
  const [target, setTarget] = useState(null);
  const [text, setText] = useState("");
  // A message to a card waiting out its Undo window: { text, questionId, tourId, left }
  const [pending, setPending] = useState(null);
  // A message Proxy wants placed: { text, guess: { questionId, question } | null, mode: "confirm" | "pick" }
  const [choice, setChoice] = useState(null);
  // A message on its way to a card: { text, questionId, tourId }
  const [sending, setSending] = useState(null);
  const [working, setWorking] = useState(false);
  // What the landlord just sent to the agent, shown until the saved copy comes back.
  const [sent, setSent] = useState(null);
  // Something new from Proxy arrived on its own: dots first, then the message.
  const [incoming, setIncoming] = useState(false);
  // Settled cards fold unless opened, or written on in this visit.
  const [opened, setOpened] = useState(() => new Set());
  const [flash, setFlash] = useState(null);
  const seenRef = useRef(null);
  const listRef = useRef(null);
  const inputRef = useRef(null);
  const timerRef = useRef(null);
  const jumpRef = useRef(-1);
  const qs = viewAsId ? `&viewAs=${encodeURIComponent(viewAsId)}` : "";
  const v = viewAsId ? `?viewAs=${encodeURIComponent(viewAsId)}` : "";

  // `quiet`: a background check. News from the other side waits behind the
  // typing dots for a moment instead of popping in.
  const load = useCallback(async ({ quiet = false } = {}) => {
    try {
      const r = await fetch(`/api/landlord/proxy-chat?listingId=${encodeURIComponent(listingId)}${qs}`);
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error || "Could not load");
      const news = (d.items ?? []).filter((i) => sideOf(i) === "proxy").map(newsOf);
      const seen = seenRef.current;
      const fresh = quiet && seen ? news.filter((k) => !seen.has(k)) : [];
      seenRef.current = new Set(news);
      if (fresh.length) {
        setIncoming(true);
        await new Promise((res) => setTimeout(res, 1400));
        setIncoming(false);
      }
      setData(d);
      setError(null);
    } catch (err) { setError(err.message); }
  }, [listingId, qs]);

  useEffect(() => { setData(null); setTarget(null); setChoice(null); setOpened(new Set()); seenRef.current = null; load(); }, [load]);
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === "visible") load({ quiet: true }); }, 8000);
    return () => clearInterval(t);
  }, [load]);
  useEffect(() => () => clearInterval(timerRef.current), []);

  const post = useCallback(async (payload) => {
    const r = await fetch(`/api/landlord/proxy-chat${v}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ listingId, ...payload }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d?.error || "Could not send that.");
    return d;
  }, [listingId, v]);

  const items = useMemo(() => {
    const list = data?.items ?? [];
    // The card being written on moves to the bottom at once, where the server will put it.
    const live = sending ?? pending;
    if (!live?.questionId && !live?.tourId) return list;
    return [...list.filter((i) => !aimsAt(live, i)), ...list.filter((i) => aimsAt(live, i))];
  }, [data, sending, pending]);
  const openQuestions = useMemo(() => items.filter((i) => i.kind === "question" && i.status === "open"), [items]);
  const needy = useMemo(() => items.filter((i) => i.state === "needs_you"), [items]);
  const writable = (i) => (i.kind === "question" ? ["open", "answered"].includes(i.status) : ["requested", "proposed", "messaging", "confirmed"].includes(i.tour.status));

  // Follow the bottom only when something actually changed, so a poll never yanks the view.
  const shape = items.map((i) => (isCard(i) ? `${newsOf(i)}:${i.exchange.length}:${i.state}` : `${i.kind}:${i.id}`)).join("|");
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [shape, pending, sending, choice, working, sent, incoming]);

  const aim = (i) => {
    setTarget((cur) => (cur && cur.kind === i.kind && cur.id === i.id ? null : { kind: i.kind, id: i.id, label: labelOf(i) }));
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const commit = useCallback(async (p) => {
    clearInterval(timerRef.current);
    setPending(null);
    setChoice(null);
    const toCard = !!(p.questionId || p.tourId);
    if (toCard) {
      setSending(p);
      setOpened((cur) => new Set(cur).add(p.questionId ? `question:${p.questionId}` : `tour:${p.tourId}`));
    } else {
      setSent(p.text);
      setWorking(true);
    }
    try {
      await post({ action: "send", text: p.text, questionId: p.questionId ?? null, tourId: p.tourId ?? null });
      await load();
      onChanged?.();
    } catch (err) {
      toast.error(err.message);
      setText(p.text);
    } finally { setWorking(false); setSent(null); setSending(null); }
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

  const busy = !!(pending || choice || sending || working);
  const send = async () => {
    const body = text.trim();
    if (!body || busy) return;
    setText("");
    if (inputRef.current) inputRef.current.style.height = "auto";
    if (target) {
      const p = { text: body, questionId: target.kind === "question" ? target.id : null, tourId: target.kind === "tour" ? target.id : null };
      setTarget(null);
      hold(p);
      return;
    }
    if (!openQuestions.length) { commit({ text: body }); return; }
    // The message shows (with Proxy typing) while Proxy works out where it goes.
    setSent(body);
    setWorking(true);
    let guess = { questionId: null, sure: false };
    try { guess = await post({ action: "route", text: body }); } catch { /* asks the landlord instead */ }
    setWorking(false);
    setSent(null);
    if (guess.sure && !guess.questionId) { commit({ text: body }); return; }
    setChoice({ text: body, guess: guess.questionId ? { questionId: guess.questionId, question: guess.question } : null, mode: guess.sure && guess.questionId ? "confirm" : "pick" });
  };

  const undo = () => {
    clearInterval(timerRef.current);
    if (pending) setText(pending.text);
    setPending(null);
    setTimeout(() => inputRef.current?.focus(), 0);
  };
  const dropChoice = () => {
    if (choice) setText(choice.text);
    setChoice(null);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const decide = async (messageId, confirm) => {
    setWorking(true);
    try {
      await post({ action: "decide", messageId, confirm });
      await load();
      onChanged?.();
    } catch (err) { toast.error(err.message); } finally { setWorking(false); }
  };

  // The pill: each press goes to the next card that needs the landlord.
  const jump = () => {
    if (!needy.length) return;
    jumpRef.current = (jumpRef.current + 1) % needy.length;
    const i = needy[jumpRef.current];
    document.getElementById(`card-${i.kind}-${i.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    setFlash(cardKey(i));
    setTimeout(() => setFlash(null), 1500);
  };

  if (error) return <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  if (!data) return <ChatSkeleton rows={4} />;

  const last = items[items.length - 1];
  const lastSide = last ? sideOf(last) : null;
  // The landlord's message inside its card while it waits out the Undo or is on its way.
  const extraFor = (i) => {
    if (aimsAt(sending, i)) return [{ id: "live", from: "you", body: sending.text, note: "Sending…" }];
    if (aimsAt(pending, i)) {
      return [{ id: "live", from: "you", body: pending.text, note: <>Sending in {pending.left}s · <button type="button" onClick={undo} className="font-semibold text-gray-700 hover:text-gray-900">Undo</button></> }];
    }
    return [];
  };

  return (
    <div className={`flex flex-col gap-3 ${fill ? "h-full min-h-0 flex-1" : ""}`}>
      <div ref={listRef} className={`relative flex flex-col overflow-y-auto ${fill ? "min-h-0 flex-1" : maxHeight}`}>
        {needy.length > 0 && (
          <div className="pointer-events-none sticky top-0 z-10 flex justify-center pb-2">
            <button type="button" onClick={jump} className="pointer-events-auto inline-flex items-center gap-1 rounded-full bg-red-600 px-3 py-1 text-xs font-semibold text-white shadow">
              {needy.length} {needy.length === 1 ? "needs" : "need"} you <ArrowDown className="h-3 w-3" />
            </button>
          </div>
        )}
        {!items.some((i) => i.kind === "agent") && <div className="mb-3"><ProxyBubble>{INTRO}</ProxyBubble></div>}
        {items.map((i, n) => {
          const prev = items[n - 1];
          const first = !prev || isCard(prev) || isCard(i) || sideOf(prev) !== sideOf(i);
          const gap = n === 0 ? "" : first ? "mt-3" : "mt-1";
          if (isCard(i)) {
            const key = cardKey(i);
            const extra = extraFor(i);
            const canFold = settled(i) && !extra.length;
            const folded = canFold && !opened.has(key);
            const toggle = () => setOpened((cur) => { const s = new Set(cur); if (s.has(key)) s.delete(key); else s.add(key); return s; });
            const props = {
              item: i, extra, folded, canFold, onToggle: toggle, highlight: flash === key,
              replying: target?.kind === i.kind && target?.id === i.id,
              onReply: writable(i) ? () => aim(i) : null,
            };
            return (
              <div key={key} className={gap}>
                {i.kind === "question"
                  ? <QuestionCard {...props} />
                  : <TourCard {...props} viewAsId={viewAsId} onDone={() => { load(); onChanged?.(); }} />}
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
        {(sent || choice) && (
          <div className={lastSide === "me" ? "mt-1" : "mt-3"}>
            <MyBubble note={choice ? "Not sent yet" : null}>{choice ? choice.text : sent}</MyBubble>
          </div>
        )}
        {choice && (
          <div className="mt-3">
            <ProxyBubble footer={
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {choice.mode === "confirm" ? (
                  <>
                    <button type="button" onClick={() => commit({ text: choice.text, questionId: choice.guess.questionId })} className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white">Yes, send it</button>
                    <button type="button" onClick={() => setChoice({ ...choice, mode: "pick" })} className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-800">No, a different one</button>
                  </>
                ) : (
                  <>
                    {openQuestions.map((q) => (
                      <button key={q.id} type="button" onClick={() => commit({ text: choice.text, questionId: q.id })} className="max-w-full truncate rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-left text-xs font-semibold text-gray-800 hover:border-gray-400">
                        {q.question}
                      </button>
                    ))}
                    <button type="button" onClick={() => commit({ text: choice.text })} className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-800 hover:border-gray-400">None, it&apos;s for you</button>
                  </>
                )}
                <button type="button" onClick={dropChoice} className="px-2 py-1.5 text-xs text-gray-500 hover:text-gray-800">Cancel</button>
              </div>
            }>
              {choice.mode === "confirm" ? `Is this for the question "${choice.guess.question}"?` : "Which question is this for?"}
            </ProxyBubble>
          </div>
        )}
        {(sent || working || incoming) && <div className="mt-3"><TypingBubble /></div>}
      </div>
      <form onSubmit={(e) => { e.preventDefault(); send(); }} className="flex shrink-0 items-end gap-2">
        <div className="flex min-h-11 flex-1 flex-col justify-center rounded-xl border border-gray-300 bg-white px-3 py-1.5 focus-within:border-gray-400">
          {target && (
            <span className="mb-0.5 flex items-center gap-1 text-[11px] text-gray-500">
              <span className="truncate">Replying to: {target.label}{target.kind === "tour" ? " (goes to them directly)" : ""}</span>
              <button type="button" onClick={() => setTarget(null)} aria-label="Stop replying to this card" className="shrink-0 hover:text-gray-800"><X className="h-3 w-3" /></button>
            </span>
          )}
          <textarea
            ref={inputRef}
            value={text}
            onChange={(e) => { setText(e.target.value); e.target.style.height = "auto"; e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`; }}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            rows={1}
            disabled={!!pending || !!choice}
            placeholder={target ? (target.kind === "tour" ? "Write to the student" : "Answer, or ask the student for a detail first") : openQuestions.length ? "Press Reply on a card, or just type" : "Tell your agent something, change a detail, or ask what it knows"}
            className="w-full resize-none border-0 bg-transparent p-0 py-1 text-base leading-6 focus:outline-none focus:ring-0"
          />
        </div>
        <button type="submit" disabled={busy || !text.trim()} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-red-600 text-white disabled:opacity-40">
          <Send className="h-5 w-5" />
        </button>
      </form>
    </div>
  );
}
