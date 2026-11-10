"use client";

import { useEffect, useRef, useState } from "react";
import { Chip, QuietChip, OtherChip, Question, FIELD } from "./ui";
import {
  NO_PREFERENCE,
  GROUP_OPTIONS,
  BIG_GROUP_MIN,
  BIG_GROUP_MAX,
  LEASE_OPTIONS,
  LEASE_OTHER_MIN,
  LEASE_OTHER_MAX,
  MOVE_IN_CHIPS,
  COMMUTE_MODES,
  nextOccurrence,
  moveInMonthOptions,
  slowestMode,
  timeLabel,
} from "@/lib/findYourPlace/options";

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

// Page 1: the five answers that decide which places are eligible at all.
export default function StepBasics({ answers, onChange }) {
  const set = (patch) => onChange({ ...answers, ...patch });

  // ── People ────────────────────────────────────────────────────────────────
  const groupNum = parseInt(answers.group, 10);
  const bigGroup = Number.isFinite(groupNum) && groupNum >= BIG_GROUP_MIN;

  // ── Lease ─────────────────────────────────────────────────────────────────
  const leaseIsOther = /^\d+$/.test(answers.lease ?? "");
  const [leaseOtherOpen, setLeaseOtherOpen] = useState(leaseIsOther);

  // ── Move-in ───────────────────────────────────────────────────────────────
  const chipMonths = MOVE_IN_CHIPS.map((c) => nextOccurrence(c.month));
  const moveInIsOther = !!answers.moveIn && answers.moveIn !== NO_PREFERENCE && !chipMonths.includes(answers.moveIn);
  const [moveInOtherOpen, setMoveInOtherOpen] = useState(moveInIsOther);

  // ── Commute ───────────────────────────────────────────────────────────────
  const mode = slowestMode(answers.modes);
  const toggleMode = (id) => {
    const modes = answers.modes.includes(id) ? answers.modes.filter((m) => m !== id) : [...answers.modes, id];
    // The follow-up is about the slowest mode, so a change of slowest mode asks again.
    const next = slowestMode(modes);
    set({ modes, commuteMax: next && next.id === mode?.id ? answers.commuteMax : null });
  };

  // On a short window the follow-up can open below the fold of the panel:
  // bring it into view rather than leaving it to be found.
  const followUpRef = useRef(null);
  const modeId = mode?.id ?? null;
  useEffect(() => {
    // Scroll the panel's own body only. scrollIntoView would move the page too.
    const body = followUpRef.current?.closest("[data-fyp-body]");
    if (modeId && body) body.scrollTo({ top: body.scrollHeight, behavior: "smooth" });
  }, [modeId]);

  return (
    <div className="flex flex-col gap-[clamp(0.5rem,calc(4dvh-18px),1.75rem)]">
      <Question title="How many people are you planning to live with, including yourself?">
        {GROUP_OPTIONS.map((g) =>
          g === "5+" ? (
            <Chip key={g} selected={bigGroup} onClick={() => set({ group: bigGroup ? null : String(BIG_GROUP_MIN) })}>
              5+
            </Chip>
          ) : (
            <Chip key={g} round selected={answers.group === g} onClick={() => set({ group: answers.group === g ? null : g })}>
              {g}
            </Chip>
          )
        )}
        <QuietChip
          selected={answers.group === NO_PREFERENCE}
          onClick={() => set({ group: answers.group === NO_PREFERENCE ? null : NO_PREFERENCE })}
        >
          No Preference
        </QuietChip>
        {bigGroup && (
          <label className="flex w-full items-center gap-2 pt-1 text-sm text-gray-500">
            How many of you?
            <input
              type="number"
              inputMode="numeric"
              min={BIG_GROUP_MIN}
              max={BIG_GROUP_MAX}
              value={groupNum}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                if (Number.isFinite(n)) set({ group: String(clamp(n, BIG_GROUP_MIN, BIG_GROUP_MAX)) });
              }}
              className={`${FIELD(true)} w-20 text-center`}
            />
            <span className="text-xs text-gray-400">We look for buildings with enough open units to fit everyone.</span>
          </label>
        )}
      </Question>

      <Question title="What's your max monthly rent per person?">
        <div className="relative">
          <span
            className={`pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm font-medium ${
              typeof answers.budget === "number" ? "text-red-600" : "text-gray-400"
            }`}
          >
            $
          </span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            step={50}
            placeholder="max / mo"
            aria-label="Max monthly rent per person, in dollars"
            value={typeof answers.budget === "number" ? answers.budget : ""}
            onChange={(e) => {
              const n = parseInt(e.target.value, 10);
              set({ budget: Number.isFinite(n) && n > 0 ? n : null });
            }}
            className={`${FIELD(typeof answers.budget === "number")} w-32 pl-7`}
          />
        </div>
        <QuietChip
          selected={answers.budget === NO_PREFERENCE}
          onClick={() => set({ budget: answers.budget === NO_PREFERENCE ? null : NO_PREFERENCE })}
        >
          No Preference
        </QuietChip>
      </Question>

      <Question title="What lease length are you looking for?">
        {LEASE_OPTIONS.map((o) => (
          <Chip
            key={o.id}
            selected={answers.lease === o.id}
            onClick={() => {
              setLeaseOtherOpen(false);
              set({ lease: answers.lease === o.id ? null : o.id });
            }}
          >
            {o.label}
          </Chip>
        ))}
        {leaseOtherOpen ? (
          <label className="flex items-center gap-1.5 text-sm text-gray-500">
            <input
              type="number"
              inputMode="numeric"
              autoFocus
              min={LEASE_OTHER_MIN}
              max={LEASE_OTHER_MAX}
              placeholder="#"
              aria-label="Lease length in months"
              value={leaseIsOther ? answers.lease : ""}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                set({ lease: Number.isFinite(n) ? String(clamp(n, LEASE_OTHER_MIN, LEASE_OTHER_MAX)) : null });
              }}
              className={`${FIELD(leaseIsOther)} w-16 text-center`}
            />
            months
          </label>
        ) : (
          <OtherChip
            onClick={() => {
              setLeaseOtherOpen(true);
              set({ lease: null });
            }}
          >
            Other
          </OtherChip>
        )}
        <QuietChip
          selected={answers.lease === NO_PREFERENCE}
          onClick={() => {
            setLeaseOtherOpen(false);
            set({ lease: answers.lease === NO_PREFERENCE ? null : NO_PREFERENCE });
          }}
        >
          No Preference
        </QuietChip>
      </Question>

      <Question title="What's your ideal move-in date?">
        {MOVE_IN_CHIPS.map((c, i) => (
          <Chip
            key={c.id}
            selected={answers.moveIn === chipMonths[i]}
            onClick={() => {
              setMoveInOtherOpen(false);
              set({ moveIn: answers.moveIn === chipMonths[i] ? null : chipMonths[i] });
            }}
          >
            {c.label}
          </Chip>
        ))}
        {moveInOtherOpen ? (
          <select
            autoFocus
            aria-label="Move-in month"
            value={moveInIsOther ? answers.moveIn : ""}
            onChange={(e) => set({ moveIn: e.target.value || null })}
            className={`${FIELD(moveInIsOther)} pr-8`}
          >
            <option value="">Pick a month</option>
            {moveInMonthOptions().map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        ) : (
          <OtherChip
            onClick={() => {
              setMoveInOtherOpen(true);
              set({ moveIn: null });
            }}
          >
            Other
          </OtherChip>
        )}
        <QuietChip
          selected={answers.moveIn === NO_PREFERENCE}
          onClick={() => {
            setMoveInOtherOpen(false);
            set({ moveIn: answers.moveIn === NO_PREFERENCE ? null : NO_PREFERENCE });
          }}
        >
          No Preference
        </QuietChip>
      </Question>

      <Question title="How do you plan to get to campus? Select all that apply.">
        {COMMUTE_MODES.map((m) => (
          <Chip key={m.id} selected={answers.modes.includes(m.id)} onClick={() => toggleMode(m.id)}>
            {m.label}
          </Chip>
        ))}
      </Question>

      {mode && (
        <Question title={mode.question} innerRef={followUpRef}>
          {mode.times.map((t) => (
            <Chip key={t} selected={answers.commuteMax === t} onClick={() => set({ commuteMax: answers.commuteMax === t ? null : t })}>
              {timeLabel(mode, t)}
            </Chip>
          ))}
        </Question>
      )}
    </div>
  );
}
