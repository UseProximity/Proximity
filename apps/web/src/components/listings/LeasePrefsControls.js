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
import { ChevronDown } from "lucide-react";
import { leaseMonthOptions, moveInHasPassed, moveInOptions } from "@/lib/listings/leaseFit";

const FORM_SELECT =
  "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400";
// The sentence's dropdowns and "Sort by" share one look (Wyatt, 2026-10-31).
// The browser's own arrow sits flush with the edge and gets clipped, so it is
// hidden and SelectChevron draws one inside the right padding instead.
const SENTENCE_SELECT =
  "max-w-full cursor-pointer appearance-none rounded-lg border border-gray-200 bg-white py-1 pl-2 pr-7 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:border-red-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400";

const SelectChevron = () => (
  <ChevronDown
    aria-hidden="true"
    className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-500"
  />
);

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
  sort = null,
  sorts = null,
  onSort = null,
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
      <label htmlFor={`${idPrefix}-${key}`} className="relative inline-flex max-w-full">
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
        <SelectChevron />
      </label>
    );

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-2 text-sm text-gray-700">
      {/* "I want a [3 bed]", but "I want [any size]" (Wyatt, 2026-10-30). */}
      <span>{value?.beds != null || only?.beds ? "I want a" : "I want"}</span>
      {part("beds", "Size", "any size", true)}
      <span>for</span>
      {part("months", "Lease length", "any length", true)}
      <span>starting</span>
      {part("moveIn", "Move-in month", "any time")}
      {(count != null || (hasAny && onClear) || sorts?.length > 0) && (
        <span className="flex flex-wrap items-center gap-3 text-xs text-gray-500 sm:ml-auto">
          {/* Sort is for this visit only (Wyatt, 2026-10-31). */}
          {sorts?.length > 0 && onSort && (
            <label htmlFor={`${idPrefix}-sort`} className="flex items-center gap-1.5">
              Sort by
              <span className="relative inline-flex">
                <select
                  id={`${idPrefix}-sort`}
                  value={sort ?? sorts[0].value}
                  onChange={(e) => onSort(e.target.value)}
                  className={SENTENCE_SELECT}
                >
                  {sorts.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <SelectChevron />
              </span>
            </label>
          )}
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
