"use client";

import { useState } from "react";
import { UNSURE } from "@/lib/matchmaking/questionScript";

const CHIP =
  "px-2.5 py-1 rounded-full bg-white border border-red-300 text-red-700 text-xs font-medium hover:bg-red-50 transition disabled:opacity-50 disabled:cursor-default";
const CHIP_ON = "px-2.5 py-1 rounded-full bg-red-600 border border-red-600 text-white text-xs font-medium transition";
const UNSURE_CHIP =
  "px-2.5 py-1 rounded-full bg-gray-100 border border-gray-300 text-gray-500 text-xs font-medium hover:bg-gray-200 transition disabled:opacity-50";

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

    // Single-pick: tapping an option submits it immediately (no separate send).
    return (
      <div className="flex flex-wrap gap-1.5">
        {baseOpts.map((opt) => (
          <button key={opt} className={CHIP} disabled={!interactive} onClick={() => submit(opt)}>
            {opt}
          </button>
        ))}
        <button className={CHIP} disabled={!interactive} onClick={() => setOtherMode(true)}>
          Something else…
        </button>
        {meta?.allowUnsure && (
          <button className={UNSURE_CHIP} disabled={!interactive} onClick={() => submit(UNSURE)}>
            No Preference
          </button>
        )}
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

  if (kind === "tradeoff") {
    // A "Would you X for Y?" narrowing question: the answer labels are real
    // answers (e.g. "Yes, worth it" / "No, keep it cheaper"), plus an optional
    // skip that prunes nothing. Rendered as compact pills in a wrapping row to
    // match the other answer kinds rather than full-width stacked boxes.
    // Tapping an answer submits it immediately (no separate send).
    return (
      <div className="flex flex-wrap gap-1.5">
        {options.map((opt) => (
          <button key={opt} className={CHIP} disabled={!interactive} onClick={() => submit(opt)}>
            {opt}
          </button>
        ))}
        {meta?.allowUnsure && (
          <button className={UNSURE_CHIP} disabled={!interactive} onClick={() => submit(UNSURE)}>
            No strong preference
          </button>
        )}
      </div>
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
    // "Yes, that's me" auto-submits the stored name; typing a different name is
    // confirmed with the send button or Enter (the bubble shows what they chose).
    const send = () => {
      if (name.trim()) submit(name.trim());
    };
    return (
      <div className="flex items-center gap-2" onKeyDown={onEnter(send)}>
        {meta?.currentName && (
          <button
            className={CHIP}
            disabled={!interactive}
            onClick={() => submit(meta.currentName, "Yes, that's me")}
          >
            Yes, that&apos;s me
          </button>
        )}
        <input
          type="text"
          placeholder="Or type a name…"
          value={name}
          disabled={!interactive}
          onChange={(e) => setName(e.target.value)}
          className="flex-1 min-w-0 text-xs bg-white border border-gray-200 rounded px-2 py-1 outline-none disabled:opacity-50"
        />
        <SendButton onClick={send} disabled={!interactive || !name.trim()} />
      </div>
    );
  }

  return null;
}
