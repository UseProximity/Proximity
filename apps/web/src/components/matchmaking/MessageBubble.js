"use client";

import { useEffect, useRef, useState } from "react";
import { UNSURE } from "@/lib/matchmaking/questionScript";

const CHIP =
  "px-2.5 py-1 rounded-full bg-white border border-red-300 text-red-700 text-xs font-medium hover:bg-red-50 transition disabled:opacity-50 disabled:cursor-default";
const CHIP_ON = "px-2.5 py-1 rounded-full bg-red-600 border border-red-600 text-white text-xs font-medium transition";
const UNSURE_CHIP =
  "px-2.5 py-1 rounded-full bg-gray-100 border border-gray-300 text-gray-500 text-xs font-medium hover:bg-gray-200 transition disabled:opacity-50";
const DONE_BTN = "mt-2 px-3 py-1 rounded-full bg-red-600 text-white text-xs font-semibold disabled:opacity-40";

function InlineDots() {
  return (
    <span className="inline-flex items-center gap-1 py-0.5">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce"
          style={{ animationDelay: `${i * 0.15}s` }}
        />
      ))}
    </span>
  );
}

// Interactive controls for a scripted question. `onAnswer` is only provided for
// the active (latest) question; older question bubbles render their chips inert.
function QuestionControls({ question, onAnswer }) {
  const { id, field, kind, options, meta } = question;
  const [submitted, setSubmitted] = useState(false);
  const interactive = !!onAnswer && !submitted;
  const submit = (value) => {
    if (submitted) return; // guard against double-answering / repeated questions
    setSubmitted(true);
    onAnswer?.({ questionId: id, field, kind, value });
  };

  const [selected, setSelected] = useState([]);
  const [max, setMax] = useState("");
  const [name, setName] = useState("");
  const [text, setText] = useState("");

  const UnsureChip = () =>
    meta?.allowUnsure ? (
      <button className={UNSURE_CHIP} disabled={!interactive} onClick={() => submit(UNSURE)}>
        No Preference
      </button>
    ) : null;

  if (kind === "choice" || kind === "yesno_pref") {
    return (
      <div className="mt-2 flex flex-wrap gap-1.5">
        {options.map((opt) => (
          <button key={opt} className={CHIP} disabled={!interactive} onClick={() => submit(opt)}>
            {opt}
          </button>
        ))}
        <UnsureChip />
      </div>
    );
  }

  if (kind === "multi") {
    const toggle = (opt) =>
      setSelected((cur) => (cur.includes(opt) ? cur.filter((o) => o !== opt) : [...cur, opt]));
    return (
      <div className="mt-2">
        <div className="flex flex-wrap gap-1.5">
          {options.map((opt) => {
            const on = selected.includes(opt);
            return (
              <button
                key={opt}
                className={on ? CHIP_ON : CHIP}
                disabled={!interactive}
                onClick={() => toggle(opt)}
              >
                {opt}
              </button>
            );
          })}
          <UnsureChip />
        </div>
        <button className={DONE_BTN} disabled={!interactive || selected.length === 0} onClick={() => submit(selected)}>
          Done
        </button>
      </div>
    );
  }

  if (kind === "month_select") {
    return (
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {options.map((opt) => (
          <button key={opt} className={CHIP} disabled={!interactive} onClick={() => submit(opt)}>
            {opt}
          </button>
        ))}
        <select
          disabled={!interactive}
          defaultValue=""
          onChange={(e) => e.target.value && submit(e.target.value)}
          className="px-2.5 py-1 rounded-full bg-white border border-red-300 text-red-700 text-xs font-medium outline-none disabled:opacity-50"
        >
          <option value="" disabled>
            Other month…
          </option>
          {(meta?.others ?? []).map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <UnsureChip />
      </div>
    );
  }

  if (kind === "pairwise") {
    // One A-vs-B comparison. Two roomy chips (priority labels run long) plus an
    // optional "no preference" skip for the whole ranking.
    return (
      <div className="mt-2 flex flex-col gap-1.5 items-start">
        {options.map((opt) => (
          <button
            key={opt}
            className="w-full text-left px-3 py-2 rounded-xl bg-white border border-red-300 text-red-700 text-xs font-medium hover:bg-red-50 transition disabled:opacity-50 disabled:cursor-default"
            disabled={!interactive}
            onClick={() => submit(opt)}
          >
            {opt}
          </button>
        ))}
        <UnsureChip />
      </div>
    );
  }

  if (kind === "rank") {
    return (
      <RankControl
        options={options}
        interactive={interactive}
        allowUnsure={meta?.allowUnsure}
        onDone={(order) => submit(order)}
        onUnsure={() => submit(UNSURE)}
      />
    );
  }

  if (kind === "budget_max") {
    return (
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="text-xs text-gray-400">$</span>
        <input
          type="number"
          inputMode="numeric"
          placeholder={meta?.maxLabel ?? "Max /mo"}
          value={max}
          disabled={!interactive}
          onChange={(e) => setMax(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && max && submit(max)}
          className="w-28 text-xs bg-white border border-gray-200 rounded px-2 py-1 outline-none disabled:opacity-50"
        />
        <button
          className="px-3 py-1 rounded-full bg-red-600 text-white text-xs font-semibold disabled:opacity-40"
          disabled={!interactive || !max}
          onClick={() => submit(max)}
        >
          Set
        </button>
        <UnsureChip />
      </div>
    );
  }

  if (kind === "open_text") {
    return (
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          type="text"
          placeholder={meta?.placeholder || "Type anything…"}
          value={text}
          disabled={!interactive}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && text.trim() && submit(text.trim())}
          className="flex-1 min-w-[10rem] text-xs bg-white border border-gray-200 rounded px-2 py-1 outline-none disabled:opacity-50"
        />
        <button
          className="px-3 py-1 rounded-full bg-red-600 text-white text-xs font-semibold disabled:opacity-40"
          disabled={!interactive || !text.trim()}
          onClick={() => submit(text.trim())}
        >
          Send
        </button>
        <button className={UNSURE_CHIP} disabled={!interactive} onClick={() => submit(UNSURE)}>
          I&apos;m all set
        </button>
      </div>
    );
  }

  if (kind === "confirm_or_replace") {
    return (
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {meta?.currentName && (
          <button className={CHIP} disabled={!interactive} onClick={() => submit(meta.currentName)}>
            Yes, that&apos;s me
          </button>
        )}
        <input
          type="text"
          placeholder="Or type a name…"
          value={name}
          disabled={!interactive}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && name.trim() && submit(name.trim())}
          className="flex-1 min-w-[8rem] text-xs bg-white border border-gray-200 rounded px-2 py-1 outline-none disabled:opacity-50"
        />
        <button
          className="px-3 py-1 rounded-full bg-red-600 text-white text-xs font-semibold disabled:opacity-40"
          disabled={!interactive || !name.trim()}
          onClick={() => submit(name.trim())}
        >
          Use
        </button>
      </div>
    );
  }

  return null;
}

// Drag-to-rank list (with up/down arrows as a touch/keyboard fallback).
function RankControl({ options, interactive, onDone, allowUnsure, onUnsure }) {
  const [order, setOrder] = useState(options);
  const dragIndex = useRef(null);

  const move = (from, to) => {
    setOrder((cur) => {
      if (to < 0 || to >= cur.length) return cur;
      const next = [...cur];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  };

  return (
    <div className="mt-2 space-y-1">
      {order.map((opt, i) => (
        <div
          key={opt}
          draggable={interactive}
          onDragStart={() => (dragIndex.current = i)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => {
            if (dragIndex.current !== null) move(dragIndex.current, i);
            dragIndex.current = null;
          }}
          className={`flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-gray-700 ${
            interactive ? "cursor-grab active:cursor-grabbing" : "opacity-70"
          }`}
        >
          <span className="text-gray-300 select-none">⠿</span>
          <span className="w-4 text-red-600 font-semibold">{i + 1}</span>
          <span className="flex-1">{opt}</span>
          <span className="flex flex-col leading-none">
            <button
              disabled={!interactive || i === 0}
              onClick={() => move(i, i - 1)}
              className="text-gray-400 hover:text-red-600 disabled:opacity-30 text-[10px]"
              aria-label="Move up"
            >
              ▲
            </button>
            <button
              disabled={!interactive || i === order.length - 1}
              onClick={() => move(i, i + 1)}
              className="text-gray-400 hover:text-red-600 disabled:opacity-30 text-[10px]"
              aria-label="Move down"
            >
              ▼
            </button>
          </span>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <button className={DONE_BTN} disabled={!interactive} onClick={() => onDone(order)}>
          Done ranking
        </button>
        {allowUnsure && (
          <button className={`mt-2 ${UNSURE_CHIP}`} disabled={!interactive} onClick={onUnsure}>
            No strong preference
          </button>
        )}
      </div>
    </div>
  );
}

export default function MessageBubble({ message, onAnswer, onEdit, onReady }) {
  const isUser = message.role === "user";
  const animate = !isUser && !!message.animate;
  const firedReady = useRef(false);

  // "Typing" effect: 0.5s of dots, then typewrite the text, then reveal chips.
  const [phase, setPhase] = useState(animate ? "dots" : "done");
  const [shown, setShown] = useState(animate ? "" : message.content);

  useEffect(() => {
    if (!animate) return;
    const t = setTimeout(() => setPhase("typing"), 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (phase !== "typing") return;
    const content = message.content ?? "";
    let i = 0;
    const iv = setInterval(() => {
      i += 1;
      setShown(content.slice(0, i));
      if (i >= content.length) {
        clearInterval(iv);
        setPhase("done");
      }
    }, 18);
    return () => clearInterval(iv);
  }, [phase, message.content]);

  const showDots = animate && phase === "dots";
  const ready = !animate || phase === "done";

  // Notify the parent once the bubble is fully rendered (typing done + chips in)
  // so it can scroll the whole bubble into view.
  useEffect(() => {
    if (ready && !firedReady.current) {
      firedReady.current = true;
      onReady?.();
    }
  }, [ready, onReady]);

  return (
    <div className="group">
      <div className={`flex items-end gap-2 ${isUser ? "flex-row-reverse" : "flex-row"}`}>
        {!isUser && (
          <div className="w-7 h-7 rounded-full bg-red-100 text-red-600 text-xs font-bold flex items-center justify-center flex-shrink-0">
            P
          </div>
        )}
        <div
          className={`max-w-[75%] px-3 py-2 rounded-2xl text-sm leading-snug whitespace-pre-wrap ${
            isUser
              ? "bg-red-600 text-white rounded-br-sm"
              : "bg-gray-100 text-gray-800 rounded-bl-sm"
          }`}
        >
          {showDots ? <InlineDots /> : animate ? shown : message.content}

          {/* Active question → answerable chips */}
          {ready && message.question && onAnswer && (
            <QuestionControls question={message.question} onAnswer={onAnswer} />
          )}

          {message.tradeoff && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {[message.tradeoff.optionA, message.tradeoff.optionB].map((opt) => (
                <button
                  key={opt}
                  onClick={() => message.onTradeoffPick?.(opt)}
                  className="px-2.5 py-1 rounded-full bg-white border border-red-300 text-red-700 text-xs font-medium hover:bg-red-50 transition"
                >
                  {opt}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Past question → Edit button beneath the bubble, shown on hover */}
      {ready && message.question && onEdit && (
        <button
          onClick={onEdit}
          className="mt-1 ml-9 inline-flex items-center gap-1 text-xs text-gray-400 hover:text-red-600 opacity-0 group-hover:opacity-100 focus:opacity-100 transition"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
          Edit
        </button>
      )}
    </div>
  );
}
