"use client";

/*
 * The three answers that narrow a listing's lease options: what size (beds,
 * 0 is a studio), how long (lease length in months) and when the student
 * wants to move in (a month).
 *
 * Size and length are toggle pills, several at a time (Wyatt, 2026-11-01):
 * "Studio or 1 bed, for 9 or 12 months". No pill on means any. Move-in stays
 * one dropdown.
 *
 *   "sentence"  on a listing. `choices` comes from listingChoices, so each
 *               row offers only what the listing has given the other picks.
 *               A row with nothing to offer is left out.
 *   "form"      the profile form: every size up to 6 beds, every length up
 *               to 24 months and every month for two years.
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
// The move-in dropdown and "Sort by" share one look (Wyatt, 2026-10-31).
// The browser's own arrow sits flush with the edge and gets clipped, so it is
// hidden and SelectChevron draws one inside the right padding instead.
const SENTENCE_SELECT =
  "max-w-full cursor-pointer appearance-none rounded-lg border border-gray-200 bg-white py-1 pl-2 pr-7 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:border-red-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400";

const PILL =
  "rounded-full border px-3 py-1 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400";
const PILL_ON = "border-red-600 bg-red-50 text-red-700";
const PILL_OFF = "border-gray-200 bg-white text-gray-700 hover:bg-gray-50";

const SelectChevron = () => (
  <ChevronDown
    aria-hidden="true"
    className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-500"
  />
);

// Pill labels: the row's own label says what the number is.
const bedPill = (n) => (n === 0 ? "Studio" : String(n));
const monthPill = (n) => `${n} mo`;

const FORM_BEDS = [0, 1, 2, 3, 4, 5, 6].map((n) => ({ value: n, label: bedPill(n) }));
const FORM_MONTHS = Array.from({ length: 24 }, (_, i) => ({ value: i + 1, label: String(i + 1) }));

const asList = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);
const toggle = (list, v) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v].sort((a, b) => a - b));

function Select({ id, value, any, options, onPick, className }) {
  return (
    <select
      id={id}
      value={value ?? ""}
      onChange={(e) => onPick(e.target.value === "" ? null : e.target.value)}
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

// One row of on/off pills. `value` is the list that is on.
function Pills({ label, options, value, onChange, pillLabel = (o) => o.label }) {
  const on = asList(value);
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const active = on.includes(o.value);
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(toggle(on, o.value))}
            className={`${PILL} ${active ? PILL_ON : PILL_OFF}`}
          >
            {pillLabel(o)}
          </button>
        );
      })}
    </div>
  );
}

// A labelled row: the label sits to the left, the controls wrap beside it.
const Row = ({ label, children }) => (
  <div className="flex items-start gap-3">
    <span className="w-14 shrink-0 pt-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</span>
    <div className="min-w-0 flex-1">{children}</div>
  </div>
);

export default function LeasePrefsControls({
  value,
  onChange,
  onClear,
  variant = "sentence",
  idPrefix = "lease-prefs",
  choices = null,
  count = null,
  sort = null,
  sorts = null,
  onSort = null,
}) {
  const hasAny = asList(value?.beds).length > 0 || !!value?.moveIn || asList(value?.months).length > 0;

  if (variant !== "sentence") {
    return <ProfileForm value={value} onChange={onChange} onClear={onClear} idPrefix={idPrefix} hasAny={hasAny} />;
  }

  const beds = choices?.beds ?? [];
  const months = choices?.months ?? [];
  return (
    <div className="space-y-2 text-sm text-gray-700">
      {beds.length > 0 && (
        <Row label="Beds">
          <Pills label="Size" options={beds} value={value?.beds} onChange={(v) => onChange({ beds: v })} pillLabel={(o) => bedPill(o.value)} />
        </Row>
      )}
      {months.length > 0 && (
        <Row label="Length">
          <Pills label="Lease length" options={months} value={value?.months} onChange={(v) => onChange({ months: v })} pillLabel={(o) => monthPill(o.value)} />
        </Row>
      )}
      <Row label="Start">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {/* Always a dropdown starting on "Any", even with one month to offer (Wyatt, 2026-10-31). */}
          <label htmlFor={`${idPrefix}-moveIn`} className="relative inline-flex max-w-full">
            <span className="sr-only">Move-in month</span>
            <Select
              id={`${idPrefix}-moveIn`}
              value={value?.moveIn}
              any="Any time"
              options={choices?.moveIn ?? []}
              onPick={(v) => onChange({ moveIn: v })}
              className={SENTENCE_SELECT}
            />
            <SelectChevron />
          </label>
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
      </Row>
    </div>
  );
}

function ProfileForm({ value, onChange, onClear, idPrefix, hasAny }) {
  const moveIn = value?.moveIn ?? null;
  const monthOpts = useMemo(() => moveInOptions(undefined, moveIn), [moveIn]);
  // A saved length past 24 stays offered so it can be turned off.
  const lengthOpts = useMemo(() => {
    const extra = asList(value?.months).filter((m) => m > 24);
    return [...FORM_MONTHS, ...leaseMonthOptions(Math.max(0, ...extra)).filter((o) => o.value > 24).map((o) => ({ value: o.value, label: String(o.value) }))];
  }, [value?.months]);
  const passed = moveInHasPassed(moveIn);

  return (
    <div className="space-y-3">
      <div>
        <p className="mb-1 text-xs font-semibold text-gray-600">Size</p>
        <Pills label="Size" options={FORM_BEDS} value={value?.beds} onChange={(v) => onChange({ beds: v })} />
      </div>
      <div>
        <p className="mb-1 text-xs font-semibold text-gray-600">Lease length (months)</p>
        <Pills label="Lease length" options={lengthOpts} value={value?.months} onChange={(v) => onChange({ months: v })} />
      </div>
      <div className="sm:w-1/2">
        <label htmlFor={`${idPrefix}-moveIn`} className="mb-1 block text-xs font-semibold text-gray-600">
          Move-in month
        </label>
        <Select
          id={`${idPrefix}-moveIn`}
          value={moveIn}
          any="Any time"
          options={monthOpts}
          onPick={(v) => onChange({ moveIn: v })}
          className={FORM_SELECT}
        />
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
