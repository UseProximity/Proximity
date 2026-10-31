"use client";

/*
 * The two answers that narrow a unit's lease options: when the student wants
 * to move in (a month) and for how long (an exact number of months). Used in
 * the lease options header ("compact") and the profile form ("form").
 *
 * Controlled: the caller owns the values and decides whether a change is saved
 * (the lease options save to the account straight away; the profile form waits
 * for its Save button). The option lists and the "has passed" rule come from
 * lib/listings/leaseFit.js.
 *
 * Given `leases` (one unit's offerings), the choices are only the months and
 * lengths that unit actually has, and the caller passes values already
 * filtered to them (prefsForUnit). Without them (the profile form) every month
 * for two years and every length up to 24 is offered.
 */

import { useMemo } from "react";
import {
  leaseMonthOptions,
  moveInHasPassed,
  moveInOptions,
  unitLeaseMonthOptions,
  unitMoveInOptions,
} from "@/lib/listings/leaseFit";

const SELECT = {
  compact:
    "rounded-md border border-gray-200 bg-white px-1.5 py-1 text-xs font-medium text-gray-700 focus:border-red-400 focus:outline-none",
  form: "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400",
};

export default function LeasePrefsControls({
  value,
  onChange,
  onClear,
  variant = "compact",
  idPrefix = "lease-prefs",
  leases = null,
}) {
  const moveIn = value?.moveIn ?? "";
  const months = value?.months ?? "";
  const monthOpts = useMemo(
    () => (leases ? unitMoveInOptions(leases) : moveInOptions(undefined, moveIn || null)),
    [leases, moveIn]
  );
  const lengthOpts = useMemo(
    () => (leases ? unitLeaseMonthOptions(leases) : leaseMonthOptions(months || null)),
    [leases, months]
  );
  const passed = moveInHasPassed(moveIn);
  const hasAny = !!(moveIn || months);
  const compact = variant === "compact";

  const moveInSelect = (
    <select
      id={`${idPrefix}-move-in`}
      value={moveIn}
      onChange={(e) => onChange({ moveIn: e.target.value || null })}
      className={SELECT[variant]}
    >
      <option value="">Any time</option>
      {monthOpts.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );

  const lengthSelect = (
    <select
      id={`${idPrefix}-months`}
      value={months}
      onChange={(e) => onChange({ months: e.target.value ? Number(e.target.value) : null })}
      className={SELECT[variant]}
    >
      <option value="">Any length</option>
      {lengthOpts.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );

  const passedHint = passed && (
    <p className="text-[11px] text-amber-700">
      That month has passed, so leases open now are shown. Pick a new month to update it.
    </p>
  );

  if (compact) {
    return (
      <div className="flex flex-col items-stretch gap-1 sm:items-end">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <label htmlFor={`${idPrefix}-move-in`} className="flex items-center gap-1.5">
            <span>Move in</span>
            {moveInSelect}
          </label>
          <label htmlFor={`${idPrefix}-months`} className="flex items-center gap-1.5">
            <span>For</span>
            {lengthSelect}
          </label>
          {hasAny && onClear && (
            <button
              type="button"
              onClick={onClear}
              className="rounded text-xs font-medium text-gray-500 underline underline-offset-2 hover:text-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
            >
              Clear
            </button>
          )}
        </div>
        {passedHint}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor={`${idPrefix}-move-in`} className="block text-xs font-semibold text-gray-600 mb-1">
            Move-in month
          </label>
          {moveInSelect}
        </div>
        <div>
          <label htmlFor={`${idPrefix}-months`} className="block text-xs font-semibold text-gray-600 mb-1">
            Lease length
          </label>
          {lengthSelect}
        </div>
      </div>
      {passedHint}
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
