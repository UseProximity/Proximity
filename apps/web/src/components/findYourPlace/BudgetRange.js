"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { FIELD } from "@/components/findYourPlace/ui";
import { BUDGET_STEPS, NO_MAX, NO_PREFERENCE, budgetAmount, money } from "@/lib/findYourPlace/options";

/*
 * Find Your Place's budget question: a Min and a Max list per person per month
 * (Wyatt, 2026-11-25). Picked, not typed, unless the student chooses "Other…",
 * which turns that list into a box for an exact amount.
 *
 * The Max list only offers amounts above the minimum, so the range can never
 * run backwards from the lists; an "Other…" amount that would is held back
 * with a note instead. An amount that is not one of the steps (a homepage
 * bracket, an older saved budget like $1,200, an "Other…" amount) is added to
 * its list so it always shows as picked.
 *
 * value: { min, max } as answers.budgetMin / answers.budget.
 * onChange({ budgetMin, budget }) with only the keys that changed.
 */

const OTHER = "other";
const NONE = "none";

// The step amounts plus `extra` when it is not one of them, in order.
function withValue(steps, extra) {
  const list = typeof extra === "number" && !steps.includes(extra) ? [...steps, extra] : steps;
  return [...list].sort((a, b) => a - b);
}

function Select({ label, value, onChange, active, children }) {
  return (
    <div className="relative">
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`${FIELD(active)} w-[8.5rem] cursor-pointer appearance-none pr-9`}
      >
        {children}
      </select>
      <ChevronDown
        className={`pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 ${active ? "text-red-600" : "text-gray-400"}`}
      />
    </div>
  );
}

function OtherBox({ label, draft, setDraft, onDone }) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm font-medium text-red-600">$</span>
      <input
        type="text"
        inputMode="numeric"
        autoFocus
        aria-label={label}
        placeholder="amount"
        value={draft}
        onChange={(e) => setDraft(e.target.value.replace(/\D/g, "").slice(0, 5))}
        onBlur={onDone}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onDone();
          }
        }}
        className={`${FIELD(true)} w-[8.5rem] pl-7`}
      />
    </div>
  );
}

export default function BudgetRange({ min, max, onChange }) {
  const maxNum = typeof max === "number" ? max : null;
  // Which side is showing its "Other…" box, and what is typed in it.
  const [typing, setTyping] = useState(null); // "min" | "max" | null
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState(null);

  const minOptions = withValue(BUDGET_STEPS.filter((n) => maxNum === null || n < maxNum), min);
  const maxOptions = withValue(BUDGET_STEPS.filter((n) => min === null || n > min), maxNum);

  const pickMin = (v) => {
    setNote(null);
    if (v === OTHER) return openOther("min");
    const next = v === NONE ? null : Number(v);
    // A minimum at or above the current top of the range asks for the top again.
    const clearMax = next !== null && (maxNum !== null ? next >= maxNum : max === NO_PREFERENCE);
    onChange({ budgetMin: next, ...(clearMax ? { budget: null } : {}) });
  };
  const pickMax = (v) => {
    setNote(null);
    if (v === OTHER) return openOther("max");
    onChange({ budget: v === NONE ? NO_MAX : Number(v) });
  };

  const openOther = (side) => {
    setTyping(side);
    const current = side === "min" ? min : maxNum;
    setDraft(typeof current === "number" ? String(current) : "");
  };

  // Leaving the box: an empty box goes back to the list unchanged; an amount
  // out of range or the wrong side of the other end stays with a note.
  const finishOther = () => {
    if (!draft) {
      setTyping(null);
      setNote(null);
      return;
    }
    const n = budgetAmount(draft);
    if (n === null) {
      setNote("Enter an amount between $100 and $20,000 a month.");
      return;
    }
    if (typing === "min" && maxNum !== null && n >= maxNum) {
      setNote(`Your min has to be below your max of ${money(maxNum)}.`);
      return;
    }
    if (typing === "max" && min !== null && n <= min) {
      setNote(`Your max has to be above your min of ${money(min)}.`);
      return;
    }
    setNote(null);
    setTyping(null);
    onChange(typing === "min" ? { budgetMin: n } : { budget: n });
  };

  return (
    <>
      <div className="flex items-center gap-2">
        {typing === "min" ? (
          <OtherBox label="Min monthly rent per person, in dollars" draft={draft} setDraft={setDraft} onDone={finishOther} />
        ) : (
          <Select label="Min monthly rent per person" value={min === null ? NONE : String(min)} onChange={pickMin} active={min !== null}>
            <option value={NONE}>No min</option>
            {minOptions.map((n) => (
              <option key={n} value={String(n)}>
                {money(n)}
              </option>
            ))}
            <option value={OTHER}>Other…</option>
          </Select>
        )}
        <span className="text-sm text-gray-400">to</span>
        {typing === "max" ? (
          <OtherBox label="Max monthly rent per person, in dollars" draft={draft} setDraft={setDraft} onDone={finishOther} />
        ) : (
          <Select
            label="Max monthly rent per person"
            value={maxNum !== null ? String(maxNum) : max === NO_MAX ? NONE : ""}
            onChange={pickMax}
            active={maxNum !== null || max === NO_MAX}
          >
            <option value="" disabled>
              Max
            </option>
            {maxOptions.map((n) => (
              <option key={n} value={String(n)}>
                {money(n)}
              </option>
            ))}
            <option value={NONE}>No max</option>
            <option value={OTHER}>Other…</option>
          </Select>
        )}
      </div>
      {note && <p className="w-full text-xs text-red-600">{note}</p>}
    </>
  );
}
