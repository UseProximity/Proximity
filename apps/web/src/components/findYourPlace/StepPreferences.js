"use client";

import { Chip } from "./ui";
import { PROMPTS, TEXT_MAX, applyChipToText } from "@/lib/findYourPlace/options";

/*
 * Page 2: one open text box, with prompts underneath for ideas.
 *
 * The box is the answer. Picking a chip writes a sentence into it ("I'd like to
 * live in the Delmar Loop or DeMun."), which the student can edit or add to in
 * their own words. Three prompts show at first; picking from one brings up
 * another, so there is always a fresh idea without a wall of chips.
 */
export default function StepPreferences({ text, chips, visible, onChange, onSkip }) {
  const toggle = (prompt, optionId) => {
    const before = chips[prompt.id] ?? [];
    const after = before.includes(optionId)
      ? before.filter((id) => id !== optionId)
      : prompt.single
      ? [optionId]
      : [...before, optionId];
    onChange({
      chips: { ...chips, [prompt.id]: after },
      text: applyChipToText(text, prompt, before, after),
      // A first pick from a prompt brings up the next hidden one.
      visible: before.length === 0 ? Math.min(PROMPTS.length, visible + 1) : visible,
    });
  };

  return (
    <div>
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
        rows={7}
        className="mt-5 block w-full resize-none rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3.5 text-sm leading-relaxed text-gray-800 outline-none placeholder:text-gray-400 focus:border-red-300 focus:bg-white"
      />

      <div className="mt-6 space-y-4">
        {PROMPTS.slice(0, visible).map((prompt) => (
          <div key={prompt.id} className="flex flex-wrap items-center gap-2">
            <span className="mr-1 text-sm font-medium text-gray-700">{prompt.label}:</span>
            {prompt.options.map((o) => (
              <Chip key={o.id} selected={(chips[prompt.id] ?? []).includes(o.id)} onClick={() => toggle(prompt, o.id)}>
                {o.label}
              </Chip>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
