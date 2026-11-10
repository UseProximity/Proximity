"use client";

import { Chip } from "./ui";
import { PROMPTS, PROMPTS_AT_ONCE, TEXT_MAX, applyChipToText, promptSentence } from "@/lib/findYourPlace/options";

/*
 * Page 2: one open text box, with prompts underneath for ideas.
 *
 * The box is the answer. Picking a chip writes a sentence into it ("I'd like to
 * live in the Delmar Loop or DeMun."), which the student can edit or add to in
 * their own words. Three prompts show at a time, each with all of its ideas.
 *
 * Picking an idea answers the prompt: the whole prompt disappears (its words
 * are in the box now, and the box is where they are changed) and the next
 * prompt takes its place (Wyatt, 2026-11-10). If the student deletes or
 * rewords that sentence, the prompt comes back, since the answer is gone.
 */

// Spread a prompt's ideas evenly over as few lines as fit, so no line is left
// holding a single chip: 9 at five a line is 5 and 4, not 5, 3 and 1.
function linesOf(options, perLine = 5) {
  if (options.length <= perLine) return [options];
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
export default function StepPreferences({ text, chips, onChange, onSkip }) {
  // A prompt is answered only while its sentence still stands in the box.
  const answered = (prompt) => {
    const sentence = promptSentence(prompt, chips[prompt.id] ?? []);
    return !!sentence && text.includes(sentence);
  };

  const pick = (prompt, optionId) => {
    const before = answered(prompt) ? chips[prompt.id] : [];
    const after = [optionId];
    onChange({
      chips: { ...chips, [prompt.id]: after },
      text: applyChipToText(text, prompt, before, after),
    });
  };

  const open = PROMPTS.filter((prompt) => !answered(prompt));

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
        {open.slice(0, PROMPTS_AT_ONCE).map((prompt) => (
          <div key={prompt.id} className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:gap-2">
            <span className="flex h-8 flex-shrink-0 items-center text-sm font-medium text-gray-700 sm:w-[104px] [@media(min-height:780px)]:h-9">
              {prompt.label}:
            </span>
            <div className="min-w-0 flex-1 space-y-2">
              {linesOf(prompt.options, prompt.perLine).map((line, i) => (
                // A line of three or more stretches to fill the width; a pair keeps its size.
                <div key={i} className="flex flex-wrap gap-2 sm:flex-nowrap">
                  {line.map((o) => (
                    <Chip
                      key={o.id}
                      dense
                      className={line.length >= 3 ? "min-w-0 sm:flex-auto" : ""}
                      onClick={() => pick(prompt, o.id)}
                    >
                      {o.label}
                    </Chip>
                  ))}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
