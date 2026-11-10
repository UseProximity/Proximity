"use client";

import { Chip } from "./ui";
import { PROMPTS, PROMPTS_AT_ONCE, OPTIONS_AT_ONCE, TEXT_MAX, applyChipToText, promptSentence } from "@/lib/findYourPlace/options";

/*
 * Page 2: one open text box, with prompts underneath for ideas.
 *
 * The box is the answer. Picking a chip writes a sentence into it ("I'd like to
 * live in the Delmar Loop or DeMun."), which the student can edit or add to in
 * their own words. Three prompts show at a time with three ideas each; a
 * picked idea is replaced by the prompt's next one, and a prompt with nothing
 * left gives its place to the next prompt.
 *
 * A picked chip disappears: its words are in the box now, and the box is where
 * they are changed (Wyatt, 2026-11-10). If the student deletes or rewords that
 * sentence, the prompt's chips come back, since the pick is no longer there.
 */
export default function StepPreferences({ text, chips, onChange, onSkip }) {
  // A prompt's picks only count while its sentence still stands in the box.
  const picked = (prompt) => {
    const ids = chips[prompt.id] ?? [];
    const sentence = promptSentence(prompt, ids);
    return sentence && text.includes(sentence) ? ids : [];
  };

  const toggle = (prompt, optionId) => {
    const before = picked(prompt);
    const after = prompt.single ? [optionId] : [...before, optionId];
    onChange({
      chips: { ...chips, [prompt.id]: after },
      text: applyChipToText(text, prompt, before, after),
    });
  };

  // The prompts that still have something to offer, with what is left of each.
  const open = PROMPTS.map((prompt) => {
    const taken = picked(prompt);
    // One answer only (furnishing): once it is picked the prompt is done.
    const left = prompt.single && taken.length ? [] : prompt.options.filter((o) => !taken.includes(o.id));
    return { prompt, left };
  }).filter((row) => row.left.length);

  return (
    <div className="flex h-full flex-col">
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
        rows={3}
        className="mt-3 block min-h-[72px] w-full flex-1 resize-none rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3.5 text-sm leading-relaxed text-gray-800 outline-none placeholder:text-gray-400 focus:border-red-300 focus:bg-white"
      />

      <div className="mt-3 space-y-2">
        {open.slice(0, PROMPTS_AT_ONCE).map(({ prompt, left }) => {
          const shown = left.slice(0, OPTIONS_AT_ONCE);
          return (
            <div key={prompt.id} className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:gap-2">
              <span className="flex h-8 flex-shrink-0 items-center text-sm font-medium text-gray-700 sm:w-[104px] [@media(min-height:780px)]:h-9">
                {prompt.label}:
              </span>
              {/* A full row of three stretches to fill the line; fewer keep their size. */}
              <div className="flex min-w-0 flex-1 flex-wrap gap-2 sm:flex-nowrap">
                {shown.map((o) => (
                  <Chip
                    key={o.id}
                    dense
                    className={shown.length >= OPTIONS_AT_ONCE ? "min-w-0 sm:flex-auto" : ""}
                    onClick={() => toggle(prompt, o.id)}
                  >
                    {o.label}
                  </Chip>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
