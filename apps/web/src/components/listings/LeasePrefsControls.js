"use client";

/*
 * The three answers that narrow a listing's lease options: what size (beds,
 * 0 is a studio), when the student wants to move in (a month) and for how long
 * (an exact number of months).
 *
 *   "sentence"  on a listing: "I want a [2 bed] for [12 months] starting
 *               [Aug 2027]" (Wyatt, 2026-10-30). `choices` comes from
 *               listingChoices, so each dropdown offers only what the listing
 *               has given the other two picks. A dropdown with a single value
 *               across the whole listing (`only`) is plain text, not a select.
 *   "form"      the profile form: every size up to 6 beds, every month for two
 *               years and every length up to 24.
 *
 * Controlled: the caller owns the values and decides whether a change is saved
 * (a listing saves to the account straight away; the profile form waits for
 * its Save button). The option lists and the "has passed" rule come from
 * lib/listings/leaseFit.js.
 */

import { useMemo } from "react";
import { leaseMonthOptions, moveInHasPassed, moveInOptions } from "@/lib/listings/leaseFit";

const FORM_SELECT =
  "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400";
const SENTENCE_SELECT =
  "max-w-full cursor-pointer rounded-lg border border-red-200 bg-red-50 py-1 pl-2 pr-7 text-sm font-semibold text-red-700 hover:bg-red-100 focus:border-red-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400";

const FORM_BEDS = [0, 1, 2, 3, 4, 5, 6].map((n) => ({ value: n, label: n === 0 ? "Studio" : `${n} bed` }));

function Select({ id, value, any, options, onPick, className, number = false }) {
  return (
    <select
      id={id}
      value={value ?? ""}
      onChange={(e) => onPick(e.target.value === "" ? null : number ? Number(e.target.value) : e.target.value)}
      className={className}
    >
      <option value="">{any}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export default function LeasePrefsControls({
  value,
  onChange,
  onClear,
  variant = "sentence",
  idPrefix = "lease-prefs",
  choices = null,
  only = null,
  count = null,
}) {
  const hasAny = value?.beds != null || !!value?.moveIn || !!value?.months;

  if (variant !== "sentence") {
    return <ProfileForm value={value} onChange={onChange} onClear={onClear} idPrefix={idPrefix} hasAny={hasAny} />;
  }

  /*
   * A single value across the whole listing is said, not asked, and so is
   * "any" when the other two picks leave nothing to choose (leases with no
   * stated start, say). Anything else is a select listing what exists given
   * the other two picks, plus an "any" to step back out.
   */
  const part = (key, label, any, number = false) =>
    only?.[key] || (value?.[key] == null && !choices?.[key]?.length) ? (
      <span className="font-semibold text-gray-900">{only?.[key]?.label ?? any}</span>
    ) : (
      <label htmlFor={`${idPrefix}-${key}`} className="inline-flex max-w-full">
        <span className="sr-only">{label}</span>
        <Select
          id={`${idPrefix}-${key}`}
          value={value?.[key]}
          any={any}
          options={choices?.[key] ?? []}
          onPick={(v) => onChange({ [key]: v })}
          className={SENTENCE_SELECT}
          number={number}
        />
      </label>
    );

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-2 text-sm text-gray-700">
      <span>I want</span>
      {part("beds", "Size", "any size", true)}
      <span>for</span>
      {part("months", "Lease length", "any length", true)}
      <span>starting</span>
      {part("moveIn", "Move-in month", "any time")}
      {(count != null || (hasAny && onClear)) && (
        <span className="flex items-center gap-3 text-xs text-gray-500 sm:ml-auto">
          {count != null && <span>{count === 1 ? "1 lease" : `${count} leases`}</span>}
          {hasAny && onClear && (
            <button
              type="button"
              onClick={onClear}
              className="rounded font-medium underline underline-offset-2 hover:text-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
            >
              Clear
            </button>
          )}
        </span>
      )}
    </div>
  );
}

function ProfileForm({ value, onChange, onClear, idPrefix, hasAny }) {
  const moveIn = value?.moveIn ?? null;
  const months = value?.months ?? null;
  const monthOpts = useMemo(() => moveInOptions(undefined, moveIn), [moveIn]);
  const lengthOpts = useMemo(() => leaseMonthOptions(months), [months]);
  const passed = moveInHasPassed(moveIn);
  const field = (key, label, any, opts, number = false) => (
    <div>
      <label htmlFor={`${idPrefix}-${key}`} className="block text-xs font-semibold text-gray-600 mb-1">
        {label}
      </label>
      <Select
        id={`${idPrefix}-${key}`}
        value={value?.[key]}
        any={any}
        options={opts}
        onPick={(v) => onChange({ [key]: v })}
        className={FORM_SELECT}
        number={number}
      />
    </div>
  );

  return (
    <div className="space-y-1">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {field("beds", "Size", "Any size", FORM_BEDS, true)}
        {field("moveIn", "Move-in month", "Any time", monthOpts)}
        {field("months", "Lease length", "Any length", lengthOpts, true)}
      </div>
      {passed && (
        <p className="text-[11px] text-amber-700">
          That month has passed, so leases open now are shown. Pick a new month to update it.
        </p>
      )}
      {hasAny && onClear && (
        <button
          type="button"
          onClick={onClear}
          className="text-xs font-medium text-gray-500 underline underline-offset-2 hover:text-gray-800"
        >
          Clear
        </button>
      )}
    </div>
  );
}
