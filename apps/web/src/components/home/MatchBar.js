"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { DollarSign, Users, Footprints, ChevronDown } from "lucide-react";
import { Chip } from "@/components/findYourPlace/ui";
import { trackEvent, recordFyp } from "@/utils/analytics";
import {
  GROUP_OPTIONS,
  BUDGET_MIN,
  BUDGET_MAX,
  COMMUTE_MODES,
} from "@/lib/findYourPlace/options";

/*
 * The homepage hero bar: Find Your Place's budget, group size and commute
 * questions, asked up front. "Start Matching" opens /find-your-place with
 * whatever was answered already filled in on its first page (the page reads
 * ?group, ?budget and ?modes). Nothing is required: an empty bar still starts.
 *
 * On a phone the three fields stack and each opens in place; from `sm` up
 * they sit in one pill and each opens a small panel underneath.
 */

const budgetLabel = (n) => `$${n.toLocaleString("en-US")}/mo`;
const groupLabel = (g) => (g === "1" ? "Just me" : `${g} people`);

// "Your" is dropped from the labels at the widths where the hero's two columns
// leave the pill too little room for it.
function Field({ icon: Icon, label, value, open, onToggle, panelLabel, children }) {
  return (
    <div className="relative sm:min-w-0 sm:flex-auto">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className={`flex w-full items-center gap-2.5 rounded-2xl px-4 py-3 text-left transition-colors sm:rounded-full sm:px-3 sm:py-2.5 ${
          open ? "bg-gray-100" : "hover:bg-gray-50"
        }`}
      >
        <Icon className={`h-[18px] w-[18px] flex-shrink-0 ${value ? "text-red-600" : "text-gray-700"}`} />
        <span className={`min-w-0 flex-1 truncate text-[15px] ${value ? "font-semibold text-gray-900" : "text-gray-600"}`}>
          {value || (
            <>
              <span className="xl:hidden min-[1400px]:inline">Your </span>
              {label}
            </>
          )}
        </span>
        <ChevronDown
          className={`h-4 w-4 flex-shrink-0 text-gray-400 transition-transform sm:hidden ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div
          role="group"
          aria-label={panelLabel}
          className="px-4 pb-3 pt-1 sm:absolute sm:left-0 sm:top-full sm:z-30 sm:mt-3 sm:w-max sm:max-w-[min(22rem,calc(100vw-2.5rem))] sm:rounded-2xl sm:border sm:border-gray-200 sm:bg-white sm:p-4 sm:shadow-[0_8px_32px_rgba(0,0,0,0.12)]"
        >
          <p className="mb-2.5 text-[13px] font-medium text-gray-900">{panelLabel}</p>
          {children}
        </div>
      )}
    </div>
  );
}

// onEngage: told each time the visitor opens a field.
export default function MatchBar({ onEngage = null }) {
  const router = useRouter();
  const rootRef = useRef(null);
  const [open, setOpen] = useState(null); // "budget" | "group" | "modes" | null
  const [budget, setBudget] = useState("");
  const [group, setGroup] = useState(null);
  const [modes, setModes] = useState([]);

  // Close on a click anywhere else, or Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (!rootRef.current?.contains(e.target)) setOpen(null);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(null);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const budgetNum = /^\d+$/.test(budget) ? Number(budget) : null;
  const budgetOk = budgetNum != null && budgetNum >= BUDGET_MIN && budgetNum <= BUDGET_MAX;
  const budgetBad = budget !== "" && !budgetOk;

  const toggle = (key) => {
    onEngage?.();
    setOpen((current) => (current === key ? null : key));
  };
  const toggleMode = (id) =>
    setModes((current) => (current.includes(id) ? current.filter((m) => m !== id) : [...current, id]));

  const start = (e) => {
    e.preventDefault();
    const params = new URLSearchParams({ src: "home" });
    if (group) params.set("group", group);
    // An amount Find Your Place would turn away is left for its own page to ask.
    if (budgetOk) params.set("budget", String(budgetNum));
    if (modes.length) params.set("modes", modes.join(","));
    const filled = (group ? 1 : 0) + (budgetOk ? 1 : 0) + (modes.length ? 1 : 0);
    trackEvent("Find Your Place Bar Started", { filled });
    recordFyp("bar_started", { filled }, "/");
    router.push(`/find-your-place?${params.toString()}`);
  };

  const picked = COMMUTE_MODES.filter((m) => modes.includes(m.id)).map((m) => m.label);
  const modesValue = picked.length > 2 ? `${picked[0]}, ${picked[1]} +${picked.length - 2}` : picked.join(", ");

  return (
    <form
      ref={rootRef}
      onSubmit={start}
      className="flex w-full max-w-[660px] flex-col gap-1 rounded-3xl border border-gray-200 bg-white p-2 shadow-[0_6px_28px_rgba(0,0,0,0.10)] sm:flex-row sm:items-center sm:gap-0.5 sm:rounded-full sm:p-1.5 sm:pl-2"
    >
      <Field
        icon={DollarSign}
        label="Budget"
        value={budgetOk ? budgetLabel(budgetNum) : ""}
        open={open === "budget"}
        onToggle={() => toggle("budget")}
        panelLabel="Max monthly rent per person"
      >
        <div className="relative w-40">
          <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm font-medium text-gray-400">$</span>
          <input
            type="text"
            inputMode="numeric"
            autoFocus
            placeholder="max / mo"
            aria-label="Max monthly rent per person, in dollars"
            aria-invalid={budgetBad}
            value={budget}
            onChange={(e) => setBudget(e.target.value.replace(/\D/g, "").slice(0, 5))}
            onKeyDown={(e) => {
              // Enter moves on to the next question instead of leaving the page.
              if (e.key === "Enter") {
                e.preventDefault();
                setOpen(budgetBad ? "budget" : "group");
              }
            }}
            className={`h-10 w-full rounded-full border bg-white pl-7 pr-4 text-sm font-medium outline-none transition-colors placeholder:text-gray-400 focus:border-red-400 ${
              budgetOk ? "border-red-600 text-red-600" : "border-gray-200 text-gray-700"
            }`}
          />
        </div>
        {budgetBad && (
          <p className="mt-2 text-xs text-red-600">
            Enter an amount between ${BUDGET_MIN.toLocaleString("en-US")} and ${BUDGET_MAX.toLocaleString("en-US")}.
          </p>
        )}
      </Field>

      <span className="hidden h-6 w-px flex-shrink-0 bg-gray-200 sm:block" aria-hidden="true" />

      <Field
        icon={Users}
        label="Roommates"
        value={group ? groupLabel(group) : ""}
        open={open === "group"}
        onToggle={() => toggle("group")}
        panelLabel="How many people, including you?"
      >
        <div className="flex gap-2">
          {GROUP_OPTIONS.map((g) => (
            <Chip
              key={g}
              round={g !== "5+"}
              selected={group === g}
              onClick={() => {
                setGroup(group === g ? null : g);
                if (group !== g) setOpen("modes");
              }}
            >
              {g}
            </Chip>
          ))}
        </div>
      </Field>

      <span className="hidden h-6 w-px flex-shrink-0 bg-gray-200 sm:block" aria-hidden="true" />

      <Field
        icon={Footprints}
        label="Commute"
        value={modesValue}
        open={open === "modes"}
        onToggle={() => toggle("modes")}
        panelLabel="How will you get to campus? Pick any."
      >
        <div className="flex flex-wrap gap-2">
          {COMMUTE_MODES.map((m) => (
            <Chip key={m.id} selected={modes.includes(m.id)} onClick={() => toggleMode(m.id)}>
              {m.label}
            </Chip>
          ))}
        </div>
      </Field>

      <button
        type="submit"
        className="mt-1 h-12 flex-shrink-0 whitespace-nowrap rounded-2xl bg-red-600 px-5 text-[15px] font-semibold text-white transition-colors hover:bg-red-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-300 sm:mt-0 sm:h-11 sm:rounded-full"
      >
        Start Matching
      </button>
    </form>
  );
}
