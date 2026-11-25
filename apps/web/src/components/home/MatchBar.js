"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { DollarSign, Users, Footprints, ChevronDown } from "lucide-react";
import { Chip } from "@/components/findYourPlace/ui";
import { trackEvent, recordFyp } from "@/utils/analytics";
import {
  GROUP_OPTIONS,
  COMMUTE_MODES,
  BUDGET_BRACKETS,
  NO_MAX,
  budgetAmount,
  budgetRangeLabel,
} from "@/lib/findYourPlace/options";

/*
 * The homepage hero bar: Find Your Place's budget, group size and commute
 * questions, asked up front. "Start Matching" opens /find-your-place with
 * whatever was answered already filled in on its first page (the page reads
 * ?group, ?budget, ?budgetMin and ?modes). Nothing is required: an empty bar
 * still starts.
 *
 * Budget is a range picked from one-tap brackets (Wyatt, 2026-11-25); "Other"
 * opens a Min and a Max box for an exact range. Find Your Place itself asks
 * with a Min and a Max list.
 *
 * On a phone or small tablet the three fields stack and each opens in place; from `md` up
 * they sit in one pill and each opens a small panel underneath.
 */

const groupLabel = (g) => (g === "1" ? "Just me" : `${g} people`);

// "Your" is dropped from the labels at the widths where the hero's two columns
// leave the pill too little room for it.
function Field({ icon: Icon, label, value, open, onToggle, panelLabel, children }) {
  return (
    <div className="relative md:min-w-0 md:flex-auto">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className={`flex w-full items-center gap-2.5 rounded-2xl px-4 py-3 text-left transition-colors md:rounded-full md:px-3 md:py-2.5 ${
          open ? "bg-gray-100" : "hover:bg-gray-50"
        }`}
      >
        <Icon className={`h-[18px] w-[18px] flex-shrink-0 ${value ? "text-red-600" : "text-gray-700"}`} />
        <span className={`min-w-0 flex-1 truncate text-[15px] ${value ? "font-semibold text-gray-900" : "text-gray-600"}`}>
          {value || (
            <>
              <span className="min-[1280px]:hidden min-[1400px]:inline">Your </span>
              {label}
            </>
          )}
        </span>
        <ChevronDown
          className={`h-4 w-4 flex-shrink-0 text-gray-400 transition-transform md:hidden ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div
          role="group"
          aria-label={panelLabel}
          className="px-4 pb-3 pt-1 md:absolute md:left-0 md:top-full md:z-30 md:mt-3 md:w-max md:max-w-[min(22rem,calc(100vw-2.5rem))] md:rounded-2xl md:border md:border-gray-200 md:bg-white md:p-4 md:shadow-[0_8px_32px_rgba(0,0,0,0.12)]"
        >
          <p className="mb-2.5 text-[13px] font-medium text-gray-900">{panelLabel}</p>
          {children}
        </div>
      )}
    </div>
  );
}

// One of the two "Other" boxes. Empty means no limit on that side.
function OtherBox({ which, value, onChange, onEnter, clearNote, autoFocus = false }) {
  return (
    <div className="relative w-28">
      <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-medium text-gray-400">$</span>
      <input
        type="text"
        inputMode="numeric"
        autoFocus={autoFocus}
        placeholder={`No ${which.toLowerCase()}`}
        aria-label={`${which} monthly rent per person, in dollars`}
        value={value}
        onChange={(e) => {
          onChange(e.target.value.replace(/\D/g, "").slice(0, 5));
          clearNote();
        }}
        onKeyDown={(e) => {
          // Enter keeps the range and moves on instead of leaving the page.
          if (e.key === "Enter") {
            e.preventDefault();
            onEnter();
          }
        }}
        className="h-10 w-full rounded-full border border-gray-200 bg-white pl-6 pr-3 text-sm font-medium text-gray-700 outline-none transition-colors placeholder:text-gray-400 focus:border-red-400"
      />
    </div>
  );
}

// onEngage: told each time the visitor opens a field.
export default function MatchBar({ onEngage = null }) {
  const router = useRouter();
  const rootRef = useRef(null);
  const [open, setOpen] = useState(null); // "budget" | "group" | "modes" | null
  // The picked range, { min, max } as Find Your Place stores it, or null.
  const [range, setRange] = useState(null);
  const [group, setGroup] = useState(null);
  const [modes, setModes] = useState([]);
  // "Other": the two boxes, and a note when what is in them will not do.
  const [otherOpen, setOtherOpen] = useState(false);
  const [minDraft, setMinDraft] = useState("");
  const [maxDraft, setMaxDraft] = useState("");
  const [otherNote, setOtherNote] = useState(null);

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

  const bracketId = range ? BUDGET_BRACKETS.find((b) => b.min === range.min && b.max === range.max)?.id ?? null : null;

  const pickBracket = (b) => {
    setOtherOpen(false);
    setOtherNote(null);
    if (bracketId === b.id) return setRange(null);
    setRange({ min: b.min, max: b.max });
    setOpen("group");
  };

  /*
   * The range in the "Other" boxes: { range } when it will do (null when both
   * are empty; an empty box is no limit on that side), or { note } saying why
   * the search would turn it away.
   */
  const readOther = () => {
    if (!minDraft && !maxDraft) return { range: null };
    const min = minDraft ? budgetAmount(minDraft) : null;
    const max = maxDraft ? budgetAmount(maxDraft) : NO_MAX;
    if ((minDraft && min === null) || (maxDraft && max === null)) return { note: "Enter amounts between $100 and $20,000 a month." };
    if (typeof max === "number" && min !== null && min >= max) return { note: "Your min has to be below your max." };
    return { range: { min, max } };
  };
  // Keeps what is in the boxes as the range. False (with the note shown)
  // when it will not do.
  const commitOther = () => {
    const read = readOther();
    setOtherNote(read.note ?? null);
    if (read.note) return false;
    setRange(read.range);
    return true;
  };
  // Leaving the Budget panel any way at all (another field, a click outside,
  // Escape) keeps whatever range in the boxes will do.
  useEffect(() => {
    if (open !== "budget" && otherOpen) commitOther();
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const openOther = () => {
    setOtherOpen(true);
    setOtherNote(null);
    setMinDraft(typeof range?.min === "number" ? String(range.min) : "");
    setMaxDraft(typeof range?.max === "number" ? String(range.max) : "");
  };

  const toggle = (key) => {
    onEngage?.();
    setOpen((current) => (current === key ? null : key));
  };
  const toggleMode = (id) =>
    setModes((current) => (current.includes(id) ? current.filter((m) => m !== id) : [...current, id]));

  const start = (e) => {
    e.preventDefault();
    // A range typed under "Other" that will not do is shown back, not
    // silently dropped.
    let chosen = range;
    if (otherOpen) {
      const read = readOther();
      if (read.note) {
        setOtherNote(read.note);
        setOpen("budget");
        return;
      }
      chosen = read.range;
    }
    // "from", not "src": ?src= is the printed QR campaign tag marketing records.
    const params = new URLSearchParams({ from: "home" });
    if (group) params.set("group", group);
    if (chosen) {
      params.set("budget", chosen.max === NO_MAX ? "nomax" : String(chosen.max));
      if (typeof chosen.min === "number") params.set("budgetMin", String(chosen.min));
    }
    if (modes.length) params.set("modes", modes.join(","));
    const filled = (group ? 1 : 0) + (chosen ? 1 : 0) + (modes.length ? 1 : 0);
    trackEvent("Find Your Place Bar Started", { filled });
    recordFyp("bar_started", { filled }, "/");
    router.push(`/find-your-place?${params.toString()}`);
  };

  const picked = COMMUTE_MODES.filter((m) => modes.includes(m.id)).map((m) => m.label);
  const modesValue = picked.length > 2 ? `${picked[0]}, ${picked[1]} +${picked.length - 2}` : picked.join(", ");

  return (
    <form
      ref={rootRef}
      data-home-match-bar
      onSubmit={start}
      className="flex w-full max-w-[660px] flex-col gap-1 rounded-3xl border border-gray-200 bg-white p-2 shadow-[0_6px_28px_rgba(0,0,0,0.10)] md:flex-row md:items-center md:gap-0.5 md:rounded-full md:p-1.5 md:pl-2"
    >
      <Field
        icon={DollarSign}
        label="Budget"
        value={range ? budgetRangeLabel(range.min, range.max) : ""}
        open={open === "budget"}
        onToggle={() => toggle("budget")}
        panelLabel="Monthly rent per person"
      >
        <div className="grid grid-cols-2 gap-2">
          {BUDGET_BRACKETS.map((b) => (
            <Chip key={b.id} selected={!otherOpen && bracketId === b.id} onClick={() => pickBracket(b)} className="whitespace-nowrap">
              {budgetRangeLabel(b.min, b.max)}
            </Chip>
          ))}
          <Chip
            selected={otherOpen || (!!range && !bracketId)}
            onClick={() => {
              if (!otherOpen) return openOther();
              setOtherOpen(false);
              setOtherNote(null);
            }}
            className="col-span-2"
          >
            Other
          </Chip>
        </div>
        {otherOpen && (
          <div className="mt-3">
            <div className="flex items-center gap-2">
              <OtherBox which="Min" value={minDraft} autoFocus onChange={setMinDraft} onEnter={() => commitOther() && setOpen("group")} clearNote={() => setOtherNote(null)} />
              <span className="text-sm text-gray-400">to</span>
              <OtherBox which="Max" value={maxDraft} onChange={setMaxDraft} onEnter={() => commitOther() && setOpen("group")} clearNote={() => setOtherNote(null)} />
            </div>
            {otherNote && <p className="mt-2 text-xs text-red-600">{otherNote}</p>}
          </div>
        )}
      </Field>

      <span className="hidden h-6 w-px flex-shrink-0 bg-gray-200 md:block" aria-hidden="true" />

      <Field
        icon={Users}
        label="Group Size"
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

      <span className="hidden h-6 w-px flex-shrink-0 bg-gray-200 md:block" aria-hidden="true" />

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
        className="mt-1 h-12 flex-shrink-0 whitespace-nowrap rounded-2xl bg-red-600 px-5 text-[15px] font-semibold text-white transition-colors hover:bg-red-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-300 md:mt-0 md:h-11 md:rounded-full"
      >
        Start Matching
      </button>
    </form>
  );
}
