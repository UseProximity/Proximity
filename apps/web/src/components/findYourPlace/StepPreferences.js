"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { Chip, QuietChip } from "./ui";
import { PROMPTS, PROMPTS_AT_ONCE, NO_PICK, TEXT_MAX, applyChipToText, standingChips } from "@/lib/findYourPlace/options";

/*
 * Page 2: one open text box, with prompts underneath for ideas.
 *
 * The box is the answer. Picking a chip writes a sentence into it ("I'd like to
 * live in the Delmar Loop or DeMun."), which the student can edit or add to in
 * their own words. Three untouched prompts show at a time, each with all of its ideas.
 *
 * A picked idea leaves its row: its words are in the box now, and the box is
 * where they are changed (Wyatt, 2026-11-10). A prompt whose ideas are
 * mutually exclusive (furnishing) goes away entirely on a pick; one where
 * several can apply (amenities) stays with what is left. The exclusive ones
 * also carry a "No Preference" chip that clears the row. If the student
 * deletes or rewords the sentence, the picks come back, since they are gone
 * from the box.
 */

// Spread a prompt's ideas evenly over as few lines as fit, so no line is left
// holding a single chip: 9 at five a line is 5 and 4, not 5, 3 and 1.
function linesOf(options, perLine = 5) {
  if (options.length <= perLine) return options.length ? [options] : [];
  const count = Math.ceil(options.length / perLine);
  const base = Math.floor(options.length / count);
  const extra = options.length % count;
  const lines = [];
  let at = 0;
  for (let i = 0; i < count; i++) {
    const size = base + (i < extra ? 1 : 0);
    lines.push(options.slice(at, at + size));
    at += size;
  }
  return lines;
}
// The box is never more than this many empty lines taller than what is in it
// (Wyatt, 2026-11-16).
const SPARE_LINES = 5;

export default function StepPreferences({ text, chips, onChange, onSkip }) {
  const boxRef = useRef(null);
  const [rows, setRows] = useState(1 + SPARE_LINES);

  // Count the lines the text wraps to by measuring the box at one row, then
  // size it to that plus the spare lines, up to 40% of the screen (then it
  // scrolls, so the ideas stay in view). Re-measured on width changes too.
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => {
      const saved = el.rows;
      el.rows = 1;
      const css = window.getComputedStyle(el);
      const line = parseFloat(css.lineHeight) || 20;
      const inner = el.scrollHeight - parseFloat(css.paddingTop) - parseFloat(css.paddingBottom);
      el.rows = saved;
      const lines = Math.max(1, Math.round(inner / line));
      setRows(lines + SPARE_LINES);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el.parentElement);
    return () => ro.disconnect();
  }, [text]);

  // A prompt's picks only count while its sentence still stands in the box.
  const standing = standingChips(text, chips);
  const picked = (prompt) => (standing[prompt.id] ?? []).filter((id) => id !== NO_PICK);

  const pick = (prompt, optionId) => {
    const before = picked(prompt);
    const after = prompt.single ? [optionId] : [...before, optionId];
    onChange({
      chips: { ...chips, [prompt.id]: after },
      text: applyChipToText(text, prompt, before, after),
    });
  };

  // Each prompt with the ideas it still has to offer; prompts with none are done.
  const open = PROMPTS.map((prompt) => {
    const taken = picked(prompt);
    const dismissed = (chips[prompt.id] ?? []).includes(NO_PICK);
    const done = dismissed || (prompt.single && taken.length > 0);
    const left = done ? [] : prompt.options.filter((o) => !taken.includes(o.id));
    // "No Preference" rides along as the last chip of an exclusive prompt.
    return {
      prompt,
      // A multi-answer prompt the student has already picked from.
      started: !prompt.single && taken.length > 0,
      left: left.length && prompt.single ? [...left, { id: NO_PICK, label: "No Preference" }] : left,
    };
  }).filter((row) => row.left.length);

  /*
   * Three untouched prompts show at a time. A multi-answer prompt that has a
   * pick stays where it is with what it has left, but stops counting toward
   * the three, so its first pick (and only its first) brings in the next
   * prompt (Wyatt, 2026-11-10).
   */
  let fresh = 0;
  const visible = open.filter((row) => row.started || fresh++ < PROMPTS_AT_ONCE);

  return (
    <div className="flex flex-col">
      <div className="flex items-start justify-between gap-4">
        <h2 className="text-[15px] font-semibold text-gray-900">What else would you like to see in your place?</h2>
        <button
          type="button"
          onClick={onSkip}
          className="h-7 flex-shrink-0 rounded-full bg-gray-100 px-3.5 text-xs font-medium text-gray-700 hover:bg-gray-200"
        >
          Skip
        </button>
      </div>

      <textarea
        value={text}
        onChange={(e) => onChange({ text: e.target.value.slice(0, TEXT_MAX) })}
        placeholder="Tell us anything..."
        aria-label="What else would you like to see in your place?"
        ref={boxRef}
        rows={rows}
        className="mt-3 block max-h-[40dvh] min-h-[72px] w-full flex-shrink resize-none rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3.5 text-sm leading-relaxed text-gray-800 outline-none placeholder:text-gray-400 focus:border-red-300 focus:bg-white"
      />

      <div className="mt-3 min-h-0 flex-shrink overflow-y-auto scrollbar-hidden divide-y divide-gray-100">
        {visible.map(({ prompt, left }) => (
          <div key={prompt.id} className="flex flex-col gap-1.5 py-2 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:gap-2">
            <span className="flex h-8 flex-shrink-0 items-center text-sm font-medium text-gray-700 sm:w-[104px] [@media(min-height:780px)]:h-9">
              {prompt.label}:
            </span>
            <div className="min-w-0 flex-1 space-y-2">
              {linesOf(left, prompt.perLine).map((line, i) => (
                // A line of three or more stretches to fill the width; a pair keeps its size.
                <div key={i} className="flex flex-wrap gap-2 sm:flex-nowrap">
                  {line.map((o) =>
                    o.id === NO_PICK ? (
                      <QuietChip
                        key={o.id}
                        className={line.length >= 3 ? "min-w-0 sm:flex-auto" : ""}
                        onClick={() => onChange({ chips: { ...chips, [prompt.id]: [NO_PICK] } })}
                      >
                        {o.label}
                      </QuietChip>
                    ) : (
                    <Chip
                      key={o.id}
                      dense
                      className={line.length >= 3 ? "min-w-0 sm:flex-auto" : ""}
                      onClick={() => pick(prompt, o.id)}
                    >
                      {o.label}
                    </Chip>
                    )
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
