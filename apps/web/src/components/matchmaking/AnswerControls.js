"use client";

import { useRef, useState } from "react";
import { UNSURE } from "@/lib/matchmaking/questionScript";

const CHIP =
  "px-2.5 py-1 rounded-full bg-white border border-red-300 text-red-700 text-xs font-medium hover:bg-red-50 transition disabled:opacity-50 disabled:cursor-default";
const CHIP_ON = "px-2.5 py-1 rounded-full bg-red-600 border border-red-600 text-white text-xs font-medium transition";
const UNSURE_CHIP =
  "px-2.5 py-1 rounded-full bg-gray-100 border border-gray-300 text-gray-500 text-xs font-medium hover:bg-gray-200 transition disabled:opacity-50";
const UNSURE_CHIP_ON =
  "px-2.5 py-1 rounded-full bg-gray-500 border border-gray-500 text-white text-xs font-medium transition disabled:opacity-50";

// Round paper-airplane send button — the single "submit this answer" affordance,
// matching the chat composer's send button. Replaces the old text "Done"/"Send".
function SendButton({ onClick, disabled, label = "Send", className = "" }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={`w-7 h-7 rounded-full bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white flex items-center justify-center transition flex-shrink-0 ${className}`}
    >
      <svg className="w-3.5 h-3.5 translate-x-px" fill="currentColor" viewBox="0 0 24 24">
        <path d="M3.478 2.405a.75.75 0 00-.926.94l2.432 7.905H13.5a.75.75 0 010 1.5H4.984l-2.432 7.905a.75.75 0 00.926.94 60.519 60.519 0 0018.445-8.986.75.75 0 000-1.218A60.517 60.517 0 003.478 2.405z" />
      </svg>
    </button>
  );
}

// Interactive controls for the active scripted question. These render in the
// composer area (next to the text input), not inside Proxy's chat bubble — the
// bubble carries the question text, the answer is entered down here.
export default function QuestionControls({ question, onAnswer }) {
  const { id, field, kind, options, meta } = question;
  const [submitted, setSubmitted] = useState(false);
  const interactive = !!onAnswer && !submitted;
  // `label` (optional) overrides what's shown in the user's sent bubble — e.g.
  // the name-confirm "Yes, that's me" chip submits the name as the value but
  // should read "Yes, that's me" in the transcript, not the name itself.
  const submit = (value, label) => {
    if (submitted) return; // guard against double-answering / repeated questions
    setSubmitted(true);
    onAnswer?.({ questionId: id, field, kind, value, ...(label ? { label } : {}) });
  };

  const [selected, setSelected] = useState([]); // multi-select set
  const [choice, setChoice] = useState(null); // single-select pick (chip kinds)
  const [max, setMax] = useState("");
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  // When a "choice" question offers an "Other" option, tapping it swaps the chip
  // row for a small text field so the user can type their own answer.
  const [otherMode, setOtherMode] = useState(false);

  // Pressing Enter while a chip is focused should SEND the current selection, not
  // re-trigger (and so toggle off) the focused chip. preventDefault stops the
  // button's synthesized click; then we run the question's send action.
  const onEnter = (fn) => (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      fn();
    }
  };

  const UnsureChip = () =>
    meta?.allowUnsure ? (
      <button className={UNSURE_CHIP} disabled={!interactive} onClick={() => submit(UNSURE)}>
        No Preference
      </button>
    ) : null;

  // Pick-one questions (incl. the move-in month): chips + an always-present
  // "Other…" escape so the student can type their own answer, never feeling
  // boxed into the canned options.
  if (kind === "choice" || kind === "yesno_pref" || kind === "month_select") {
    // Drop any literal "Other" option from the script — we always render our own.
    const baseOpts = options.filter((o) => !/^other$/i.test(o));

    if (otherMode) {
      return (
        <div className="flex items-center gap-2">
          <input
            type="text"
            autoFocus
            placeholder="Type your answer…"
            value={text}
            disabled={!interactive}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && text.trim() && submit(text.trim())}
            className="flex-1 min-w-0 text-xs bg-white border border-gray-200 rounded px-2 py-1 outline-none disabled:opacity-50"
          />
          <button className={UNSURE_CHIP} disabled={!interactive} onClick={() => setOtherMode(false)}>
            Back
          </button>
          <SendButton onClick={() => text.trim() && submit(text.trim())} disabled={!interactive || !text.trim()} />
        </div>
      );
    }

    const send = () => {
      if (choice) submit(choice);
    };

    return (
      <div onKeyDown={onEnter(send)} className="flex items-end gap-2">
        <div className="flex flex-wrap gap-1.5 flex-1">
          {baseOpts.map((opt) => (
            <button
              key={opt}
              className={choice === opt ? CHIP_ON : CHIP}
              disabled={!interactive}
              onClick={() => setChoice(opt)}
            >
              {opt}
            </button>
          ))}
          <button className={CHIP} disabled={!interactive} onClick={() => setOtherMode(true)}>
            Something else…
          </button>
          {meta?.allowUnsure && (
            <button
              className={choice === UNSURE ? UNSURE_CHIP_ON : UNSURE_CHIP}
              disabled={!interactive}
              onClick={() => setChoice(UNSURE)}
            >
              No Preference
            </button>
          )}
        </div>
        <SendButton onClick={send} disabled={!interactive || !choice} />
      </div>
    );
  }

  if (kind === "multi") {
    const toggle = (opt) =>
      setSelected((cur) => (cur.includes(opt) ? cur.filter((o) => o !== opt) : [...cur, opt]));
    // Values the student typed via "Other…" — shown as their own selected chips.
    const customSelected = selected.filter((s) => !options.includes(s));
    const addCustom = () => {
      const t = text.trim();
      if (t && !selected.includes(t)) setSelected((cur) => [...cur, t]);
      setText("");
    };
    // Fold any pending typed value into the selection and submit the whole set.
    const sendMulti = () => {
      const t = text.trim();
      const next = t && !selected.includes(t) ? [...selected, t] : selected;
      if (next.length) submit(next);
    };
    return (
      <div onKeyDown={onEnter(sendMulti)}>
        <div className="flex items-end gap-2">
          <div className="flex flex-wrap gap-1.5 flex-1">
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
            {customSelected.map((opt) => (
              <button key={opt} className={CHIP_ON} disabled={!interactive} onClick={() => toggle(opt)}>
                {opt} ✕
              </button>
            ))}
            <button className={CHIP} disabled={!interactive} onClick={() => setOtherMode((v) => !v)}>
              Other…
            </button>
            <UnsureChip />
          </div>
          <SendButton
            onClick={sendMulti}
            disabled={!interactive || (selected.length === 0 && !text.trim())}
          />
        </div>
        {otherMode && (
          <div className="flex flex-wrap items-center gap-2 mt-2">
            <input
              type="text"
              autoFocus
              placeholder="Add your own…"
              value={text}
              disabled={!interactive}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendMulti()}
              className="flex-1 min-w-[10rem] text-xs bg-white border border-gray-200 rounded px-2 py-1 outline-none disabled:opacity-50"
            />
            <button className={CHIP} disabled={!interactive || !text.trim()} onClick={addCustom}>
              Add
            </button>
          </div>
        )}
      </div>
    );
  }

  if (kind === "contact") {
    // "Want me to reach out to any of these owners?" — pick any subset of the 3
    // matches (no free-text "Other"), or decline with "No thanks".
    const toggle = (opt) =>
      setSelected((cur) => (cur.includes(opt) ? cur.filter((o) => o !== opt) : [...cur, opt]));
    return (
      <div onKeyDown={onEnter(() => selected.length && submit(selected))} className="flex items-end gap-2">
        <div className="flex flex-wrap gap-1.5 flex-1">
          {options.map((opt) => (
            <button
              key={opt}
              className={selected.includes(opt) ? CHIP_ON : CHIP}
              disabled={!interactive}
              onClick={() => toggle(opt)}
            >
              {opt}
            </button>
          ))}
          <button className={UNSURE_CHIP} disabled={!interactive} onClick={() => submit([], "No thanks")}>
            No thanks
          </button>
        </div>
        <SendButton onClick={() => selected.length && submit(selected)} disabled={!interactive || selected.length === 0} />
      </div>
    );
  }

  if (kind === "pairwise") {
    // One A-vs-B comparison. Two roomy chips (priority labels run long) plus an
    // optional "no preference" skip for the whole ranking. Pick one, then send.
    const send = () => {
      if (choice) submit(choice);
    };
    return (
      <div className="flex flex-col gap-1.5 items-start" onKeyDown={onEnter(send)}>
        {options.map((opt) => (
          <button
            key={opt}
            className={`w-full text-left px-3 py-2 rounded-xl border text-xs font-medium transition disabled:opacity-50 disabled:cursor-default ${
              choice === opt
                ? "bg-red-600 border-red-600 text-white"
                : "bg-white border-red-300 text-red-700 hover:bg-red-50"
            }`}
            disabled={!interactive}
            onClick={() => setChoice(opt)}
          >
            {opt}
          </button>
        ))}
        {meta?.allowUnsure && (
          <button
            className={choice === UNSURE ? UNSURE_CHIP_ON : UNSURE_CHIP}
            disabled={!interactive}
            onClick={() => setChoice(UNSURE)}
          >
            No Preference
          </button>
        )}
        <div className="w-full flex justify-end pt-1">
          <SendButton onClick={send} disabled={!interactive || !choice} />
        </div>
      </div>
    );
  }

  if (kind === "tradeoff") {
    // A "Would you X for Y?" narrowing question: the answer labels are real
    // answers (e.g. "Yes, worth it" / "No, keep it cheaper"), plus an optional
    // skip that prunes nothing. Rendered as compact pills in a wrapping row to
    // match the other answer kinds rather than full-width stacked boxes.
    const send = () => {
      if (choice) submit(choice);
    };
    return (
      <div onKeyDown={onEnter(send)} className="flex items-end gap-2">
        <div className="flex flex-wrap gap-1.5 flex-1">
          {options.map((opt) => (
            <button
              key={opt}
              className={choice === opt ? CHIP_ON : CHIP}
              disabled={!interactive}
              onClick={() => setChoice(opt)}
            >
              {opt}
            </button>
          ))}
          {meta?.allowUnsure && (
            <button
              className={choice === UNSURE ? UNSURE_CHIP_ON : UNSURE_CHIP}
              disabled={!interactive}
              onClick={() => setChoice(UNSURE)}
            >
              No strong preference
            </button>
          )}
        </div>
        <SendButton onClick={send} disabled={!interactive || !choice} />
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

  if (kind === "slider") {
    return (
      <CapacityRange
        meta={meta}
        interactive={interactive}
        allowUnsure={meta?.allowUnsure}
        onSend={(value, label) => submit(value, label)}
        onUnsure={() => submit(UNSURE)}
      />
    );
  }

  if (kind === "budget_max") {
    return (
      <div className="flex items-center gap-2">
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
        <UnsureChip />
        <SendButton className="ml-auto" onClick={() => max && submit(max)} disabled={!interactive || !max} />
      </div>
    );
  }

  if (kind === "open_text") {
    return (
      <div className="flex items-center gap-2">
        <input
          type="text"
          placeholder={meta?.placeholder || "Type anything…"}
          value={text}
          disabled={!interactive}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && text.trim() && submit(text.trim())}
          className="flex-1 min-w-0 text-xs bg-white border border-gray-200 rounded px-2 py-1 outline-none disabled:opacity-50"
        />
        <button className={UNSURE_CHIP} disabled={!interactive} onClick={() => submit(UNSURE)}>
          I&apos;m all set
        </button>
        <SendButton onClick={() => text.trim() && submit(text.trim())} disabled={!interactive || !text.trim()} />
      </div>
    );
  }

  if (kind === "confirm_or_replace") {
    // "Yes, that's me" selects (rather than auto-sends): the user confirms with
    // the send button or Enter. Its value is the name, but the bubble shows the
    // chip label. Typing a name clears the chip, and vice versa.
    const send = () => {
      if (choice === "self" && meta?.currentName) submit(meta.currentName, "Yes, that's me");
      else if (name.trim()) submit(name.trim());
    };
    const canSend = (choice === "self" && !!meta?.currentName) || !!name.trim();
    return (
      <div className="flex items-center gap-2" onKeyDown={onEnter(send)}>
        {meta?.currentName && (
          <button
            className={choice === "self" ? CHIP_ON : CHIP}
            disabled={!interactive}
            onClick={() => {
              setChoice("self");
              setName("");
            }}
          >
            Yes, that&apos;s me
          </button>
        )}
        <input
          type="text"
          placeholder="Or type a name…"
          value={name}
          disabled={!interactive}
          onChange={(e) => {
            setName(e.target.value);
            setChoice(null);
          }}
          className="flex-1 min-w-0 text-xs bg-white border border-gray-200 rounded px-2 py-1 outline-none disabled:opacity-50"
        />
        <SendButton onClick={send} disabled={!interactive || !canSend} />
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
    <div className="space-y-1">
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
      <div className="flex items-center gap-2 pt-1">
        {allowUnsure && (
          <button className={UNSURE_CHIP} disabled={!interactive} onClick={onUnsure}>
            No strong preference
          </button>
        )}
        <SendButton className="ml-auto" onClick={() => onDone(order)} disabled={!interactive} label="Done ranking" />
      </div>
    </div>
  );
}

// Two-sided "capacity" range slider. The student drags a low and a high handle to
// pick a group-size range (e.g. 2–4 people); the matcher then keeps only listings
// whose capacity sits inside it. Compact enough to sit on one row with the
// "No Preference" chip and the send button. The selected range shows as "X–Y" on
// the side and updates live; a tooltip rides the handle you're dragging.
function CapacityRange({ meta, interactive, allowUnsure, onSend, onUnsure }) {
  const min = meta?.min ?? 1;
  const max = meta?.max ?? 6;
  const unit = meta?.unit || "";
  const plusOnMax = !!meta?.plusOnMax;
  const trackRef = useRef(null);
  // Default to the full span — a neutral "any size" until the student narrows it.
  const [lo, setLo] = useState(min);
  const [hi, setHi] = useState(max);
  const [active, setActive] = useState(null); // "lo" | "hi" while dragging

  // The top stop reads (and submits) as "6+" — i.e. "or more", no upper bound.
  const display = (n) => (plusOnMax && n >= max ? `${max}+` : String(n));
  const pct = (n) => ((n - min) / (max - min)) * 100;
  const plural = lo === 1 && hi === 1 ? unit : unit && `${unit}s`;

  const valueFromX = (clientX) => {
    const el = trackRef.current;
    if (!el) return min;
    const rect = el.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return Math.round(min + frac * (max - min));
  };

  const moveThumb = (which, v) => {
    if (which === "lo") setLo(Math.min(v, hi));
    else setHi(Math.max(v, lo));
  };

  const onPointerMove = (e) => {
    if (!active) return;
    moveThumb(active, valueFromX(e.clientX));
  };
  const endDrag = () => setActive(null);

  // Tapping the track grabs the nearer handle (ties / taps past both go to the
  // side they fall on) so an overlapped pair can always be pulled apart.
  const onTrackDown = (e) => {
    if (!interactive) return;
    const v = valueFromX(e.clientX);
    const which = v < lo ? "lo" : v > hi ? "hi" : Math.abs(v - lo) <= Math.abs(v - hi) ? "lo" : "hi";
    moveThumb(which, v);
    setActive(which);
    trackRef.current?.setPointerCapture?.(e.pointerId);
  };

  const send = () => {
    // Chip-compatible string the matcher parses: "2-4", or "2-6+" when the high
    // handle sits at the top stop (meaning "2 or more"). The bubble shows "2–4 persons".
    onSend(`${lo}-${display(hi)}`, unit ? `${display(lo)}–${display(hi)} ${plural}` : `${display(lo)}–${display(hi)}`);
  };

  const renderThumb = (which, value) => (
    <div
      key={which}
      role="slider"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      tabIndex={interactive ? 0 : -1}
      onPointerDown={(e) => {
        if (!interactive) return;
        e.stopPropagation();
        setActive(which);
        e.currentTarget.setPointerCapture?.(e.pointerId);
      }}
      onKeyDown={(e) => {
        if (!interactive) return;
        if (e.key === "ArrowLeft" || e.key === "ArrowDown") { e.preventDefault(); moveThumb(which, value - 1); }
        if (e.key === "ArrowRight" || e.key === "ArrowUp") { e.preventDefault(); moveThumb(which, value + 1); }
        if (e.key === "Enter") { e.preventDefault(); send(); }
      }}
      style={{ left: `${pct(value)}%` }}
      className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-white border-2 border-red-500 shadow-sm transition-transform ${
        interactive ? "cursor-grab active:cursor-grabbing hover:scale-110" : "opacity-60"
      } ${active === which ? "scale-110 z-10" : ""}`}
    >
      {active === which && (
        <span className="absolute -top-6 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded bg-gray-800 text-white text-[10px] font-semibold leading-none tabular-nums whitespace-nowrap pointer-events-none">
          {display(value)}
        </span>
      )}
    </div>
  );

  return (
    <div
      className="flex items-center gap-3"
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerLeave={endDrag}
      onPointerCancel={endDrag}
    >
      <span className="text-xs font-semibold text-red-600 tabular-nums whitespace-nowrap min-w-[2.75rem] text-center">
        {display(lo)}
        {"–"}
        {display(hi)}
      </span>
      <div
        ref={trackRef}
        onPointerDown={onTrackDown}
        className="relative flex-1 h-6 flex items-center select-none touch-none"
      >
        <div className="absolute inset-x-0 h-1.5 rounded-full bg-gray-200" />
        <div
          className="absolute h-1.5 rounded-full bg-red-500"
          style={{ left: `${pct(lo)}%`, right: `${100 - pct(hi)}%` }}
        />
        {renderThumb("lo", lo)}
        {renderThumb("hi", hi)}
      </div>
      {allowUnsure && (
        <button className={UNSURE_CHIP} disabled={!interactive} onClick={onUnsure}>
          No Preference
        </button>
      )}
      <SendButton onClick={send} disabled={!interactive} />
    </div>
  );
}
