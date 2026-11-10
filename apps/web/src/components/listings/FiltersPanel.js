"use client";

import { useState } from "react";
import Link from "next/link";
import { DEFAULT_FILTERS } from "@/lib/listings/filterListings";
import {
  ClearFilter,
  StepRange,
  useLiveFilters,
  stepIndex,
  stepLimits,
  BED_STEPS,
  BATH_STEPS,
} from "@/components/listings/FilterComponents";
import {
  PriceRangeSlider,
  rentRange,
  rentFilters,
} from "@/components/listings/PriceFilterCard";

const ACCENT = "panel";
// No edit waiting to be sent. One object, so "nothing waiting" is not a change.
const NO_EDITS = {};

// The design shows one stop fewer than the filter has: its last stop is the
// open end ("" = any distance), so the "45" and "20" minute values are not
// offered here (they still filter as before, and show at the last stop).
const CAMPUS_STEPS = [
  { label: "10 min", value: "10" },
  { label: "15 min", value: "15" },
  { label: "20 min", value: "20" },
  { label: "30min", value: "30" },
  { label: "45min+", value: "" },
];
const SHUTTLE_STEPS = [
  { label: "2 min", value: "2" },
  { label: "5 min", value: "5" },
  { label: "10 min", value: "10" },
  { label: "20min", value: "" },
];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
// February offers the 29th: the filter is for a month of any year.
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

// Lease durations always offered. The renter can add others with "Other".
const DURATIONS = ["6-month", "10-month", "12-month"];
const MAX_DURATION_MONTHS = 36;
// "9-month" to "9-Month Lease". The two older values (from filters saved before
// durations were month counts) keep their names.
const durationLabel = (value) =>
  ({ semester: "Semester Lease", summer: "Summer Lease" })[value] ||
  `${parseInt(value, 10)}-Month Lease`;
const durationMonths = (value) => parseInt(value, 10) || 0;
const HOME_TYPES = [
  { label: "Apartment", value: "apartment" },
  { label: "House", value: "house" },
  { label: "Studio", value: "studio" },
  { label: "Townhouse", value: "townhouse" },
  { label: "Single Room", value: "single_room" },
  { label: "Condo", value: "condo" },
];
// The labels say what the listing data knows: it records laundry, parking and
// storage, not whether they are in-unit, private or extra. The values are the
// filter's older names, kept so saved filters still mean the same thing
// (filterListings maps them to the data's names).
const AMENITIES = [
  { label: "Dishwasher", value: "dishwasher" },
  { label: "Laundry", value: "in_unit_laundry" },
  { label: "Air Conditioning", value: "ac_heating" },
  { label: "Mailroom", value: "mailroom" },
  { label: "Pets Allowed", value: "pets_allowed" },
  { label: "Storage", value: "extra_storage" },
  { label: "Parking", value: "private_parking" },
  { label: "Pool", value: "pool" },
  { label: "Study Rooms", value: "study_room" },
  { label: "Gym / Fitness", value: "gym" },
];
// Every value is one the listing data records (the feed's utilitiesRowToArray).
// The design's Hot Water and Yard Care are not recorded, so they matched
// nothing; Heat and Cable take their places.
const UTILITIES = [
  { label: "Water", value: "water" },
  { label: "Electric", value: "electric" },
  { label: "Gas", value: "gas" },
  { label: "Internet", value: "internet" },
  { label: "Trash", value: "trash" },
  { label: "Heat", value: "heat" },
  { label: "Sewer", value: "sewer" },
  { label: "Cable", value: "cable" },
];
const FURNISHED = [
  { label: "Any", value: "" },
  { label: "Furnished", value: "furnished" },
  { label: "Unfurnished", value: "unfurnished" },
];

// A titled block. className places it (its top margin), inset is the title's
// and chips' left padding: the design does not keep one left edge. With
// onClear (passed while the filter has something filled in) a tiny Clear sits
// next to the title.
function Section({ title, className = "", inset = "pl-5", large = false, onClear, children }) {
  return (
    <div className={className}>
      <p className={`${inset} ${large ? "text-sm leading-[17px]" : "text-xs leading-4"} flex items-baseline gap-2 font-bold text-black`}>
        {title}
        {onClear && <ClearFilter onClear={onClear} />}
      </p>
      {children}
    </div>
  );
}

// Side filters panel of the browse page, and the body of the phone's filter
// drawer (drawer: it fills the drawer, which has the heading, and its chips are
// large enough to tap). It shows the page's filters with its own edits that
// have not been sent yet on top, and keeps no other copy of them: a change or
// a reset made anywhere else on the page shows here at once and is never
// overwritten by an old copy. On the page the edits (only the fields that
// changed) go to onChange as they are made, so the results update live and
// there is no Apply button; the drawer covers the results, so it holds its
// edits until Apply, which sends the edited filters to onApply. onReset clears
// the site's filters and search.
export default function FiltersPanel({
  listings,
  filters,
  onChange,
  onApply,
  onReset,
  drawer = false,
}) {
  const [edits, setEdits] = useState(NO_EDITS);
  const draft = { ...filters, ...edits };
  useLiveFilters(edits, (sent) => {
    if (drawer || sent === NO_EDITS) return;
    onChange(sent);
    setEdits(NO_EDITS);
  });
  const set = (patch) => setEdits((e) => ({ ...e, ...patch }));
  // The field's value as shown: an edit not sent yet, else the page's filter.
  const shown = (e, field) => (field in e ? e[field] : filters[field]) || [];
  const toggle = (field, value) =>
    setEdits((e) => {
      const cur = shown(e, field);
      return {
        ...e,
        [field]: cur.includes(value)
          ? cur.filter((v) => v !== value)
          : [...cur, value],
      };
    });

  // Durations added with "Other" (and any already in the filters that are not
  // one of the three offered), kept as chips for as long as the panel lives.
  const [addedDurations, setAddedDurations] = useState(() =>
    (filters.leaseAvailability || []).filter((v) => !DURATIONS.includes(v))
  );
  // The "Other" box: null when closed, else the text typed so far.
  const [otherMonths, setOtherMonths] = useState(null);
  const addDuration = () => {
    const months = Number(otherMonths);
    setOtherMonths(null);
    if (!Number.isInteger(months) || months < 1 || months > MAX_DURATION_MONTHS)
      return;
    const value = `${months}-month`;
    if (!DURATIONS.includes(value))
      setAddedDurations((added) => (added.includes(value) ? added : [...added, value]));
    setEdits((e) => {
      const cur = shown(e, "leaseAvailability");
      return cur.includes(value) ? e : { ...e, leaseAvailability: [...cur, value] };
    });
  };
  const durationOptions = [...DURATIONS, ...addedDurations]
    .sort((a, b) => durationMonths(a) - durationMonths(b))
    .map((value) => ({ label: durationLabel(value), value }));
  const chipSize = drawer ? "h-9 px-4 text-xs" : "h-5 px-2.5 text-[10px]";
  // "Other" chip of Duration: opens a small box for a number of months, which
  // Enter or Add turns into a selected chip in the list.
  const otherDuration =
    otherMonths === null ? (
      <button
        type="button"
        onClick={() => setOtherMonths("")}
        className={`${chipSize} rounded-full border border-dashed border-gray-300 bg-white font-medium text-[#495564] transition-colors hover:border-gray-400`}
      >
        Other
      </button>
    ) : (
      <span
        className={`${drawer ? "h-9 text-xs" : "h-5 text-[10px]"} flex items-center gap-1 rounded-full border border-[#FF2B3A] bg-white pl-3 pr-1 font-medium text-[#495564]`}
      >
        <input
          autoFocus
          inputMode="numeric"
          aria-label="Lease length in months"
          placeholder="9"
          // Clicking anywhere else closes the box without adding. (Add keeps
          // the focus here, see its onMouseDown, so it is not "anywhere else".)
          onBlur={() => setOtherMonths(null)}
          value={otherMonths}
          onChange={(e) => setOtherMonths(e.target.value.replace(/\D/g, "").slice(0, 2))}
          onKeyDown={(e) => {
            if (e.key === "Enter") addDuration();
            if (e.key === "Escape") setOtherMonths(null);
          }}
          className="w-6 bg-transparent text-center outline-none placeholder:text-gray-300"
        />
        months
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={addDuration}
          className={`${drawer ? "h-7 px-3" : "h-3.5 px-2"} ml-1 rounded-full bg-[#FF2B3A] font-medium text-white`}
        >
          Add
        </button>
      </span>
    );

  // Clear for a section: there only while one of its fields is filled in, and
  // empties those fields ("" for a value, [] for a list).
  const clearer = (...fields) =>
    fields.some((f) => (Array.isArray(draft[f]) ? draft[f].length : draft[f]))
      ? () =>
          set(
            Object.fromEntries(
              fields.map((f) => [f, Array.isArray(DEFAULT_FILTERS[f]) ? [] : ""])
            )
          )
      : undefined;

  // One of the two Move-in Date dropdowns. extra(value) gives other fields to
  // set along with it.
  const moveInSelect = (placeholder, field, options, className, extra, disabled = false) => (
    <select
      aria-label={`Move-in ${placeholder.toLowerCase()}`}
      value={draft[field] || ""}
      disabled={disabled}
      onChange={(e) => set({ [field]: e.target.value, ...extra?.(e.target.value) })}
      className={`${className} ${drawer ? "h-9 text-xs" : "h-8 text-[11px]"} min-w-0 cursor-pointer rounded-lg border bg-white px-2 outline-none transition-colors focus:border-[#FF2B3A] disabled:cursor-default disabled:bg-gray-50 disabled:text-gray-300 ${
        draft[field] ? "border-[#FF2B3A] text-gray-900" : "border-gray-300 text-gray-400"
      }`}
    >
      <option value="">{placeholder}</option>
      {options.map(([value, label]) => (
        <option key={value} value={value}>
          {label}
        </option>
      ))}
    </select>
  );

  const slider = (title, className, onClear, children) => (
    <Section title={title} className={className} large={drawer} onClear={onClear}>
      <div className="mx-7 mt-2.5">{children}</div>
    </Section>
  );
  const stepSlider = (title, className, steps, lowKey, highKey) =>
    slider(
      title,
      className,
      clearer(lowKey, highKey),
      <StepRange
        steps={steps}
        accent={ACCENT}
        low={stepIndex(steps, draft[lowKey], 0)}
        high={stepIndex(steps, draft[highKey], steps.length - 1)}
        onChange={(low, high) => {
          const [min, max] = stepLimits(steps, { low, high });
          set({ [lowKey]: min, [highKey]: max });
        }}
      />
    );
  const distanceSlider = (title, className, steps, field) =>
    slider(
      title,
      className,
      clearer(field),
      <StepRange
        steps={steps}
        accent={ACCENT}
        single
        high={stepIndex(steps, draft[field], steps.length - 1)}
        onChange={(_, high) => set({ [field]: steps[high].value })}
      />
    );
  // Chips: several can be on (field holds an array), or with single exactly one.
  const chips = (title, className, field, options, { inset, single, after } = {}) => (
    <Section title={title} className={className} inset={inset} large={drawer} onClear={clearer(field)}>
      <div className={`mt-2 flex flex-wrap gap-x-1.5 gap-y-2 pr-4 ${inset || "pl-5"}`}>
        {options.map(({ label, value }) => {
          const selected = single
            ? (draft[field] || "") === value
            : (draft[field] || []).includes(value);
          return (
            <button
              key={value}
              type="button"
              onClick={() => (single ? set({ [field]: value }) : toggle(field, value))}
              className={`${chipSize} rounded-full border font-medium shadow-[0_1px_2px_rgba(0,0,0,0.12)] transition-colors ${
                selected
                  ? "border-[#FF2B3A] bg-[#FF2B3A] text-white"
                  : "border-gray-200 bg-white text-[#495564] hover:border-gray-300"
              }`}
            >
              {label}
            </button>
          );
        })}
        {after}
      </div>
    </Section>
  );

  const price = rentRange(draft.minRent, draft.maxRent);
  // Clear All: top right of the panel as in the design, in the footer of the
  // phone's drawer (which has its own heading).
  const clearAll = (className) => (
    <button
      type="button"
      onClick={() => {
        onReset();
        setEdits(NO_EDITS);
      }}
      className={`shrink-0 rounded-full border font-medium text-[#495564] hover:bg-gray-50 ${className}`}
    >
      Clear All
    </button>
  );

  return (
    <div
      className={`flex min-h-0 flex-col ${
        drawer
          ? "flex-1"
          : "w-[276px] overflow-hidden rounded-[22px] border border-[#E6E7EB] bg-white"
      }`}
    >
      <div className={`min-h-0 flex-1 overflow-y-auto pb-5 ${drawer ? "" : "pt-5"}`}>
      {!drawer && (
        <div className="flex items-center justify-between pl-5 pr-4">
          <h2 className="text-sm font-semibold leading-5 text-black">
            Filters By:
          </h2>
          {clearAll("h-5 px-2.5 text-[10px] border-[#D0D5DD]")}
        </div>
      )}

      <Section title="Price Range" className="mt-4" large={drawer} onClear={clearer("minRent", "maxRent")}>
        <PriceRangeSlider
          listings={listings}
          low={price.low}
          high={price.high}
          onChange={(low, high) => set(rentFilters({ low, high }))}
          barsClass="ml-[46px] mr-[48px] mt-2.5 h-[56px]"
          sliderClass="-mt-2 mx-7"
          accent={ACCENT}
        />
      </Section>
      {stepSlider("Bedrooms", "mt-5", BED_STEPS, "bedrooms", "maxBedrooms")}
      {stepSlider("Bathrooms", "mt-5", BATH_STEPS, "bathrooms", "maxBathrooms")}
      {distanceSlider("Walking Distance to Campus", "mt-5", CAMPUS_STEPS, "distance")}
      {distanceSlider("Walking Distance to Shuttle", "mt-5", SHUTTLE_STEPS, "distanceToShuttle")}
      {chips("Duration", "mt-6", "leaseAvailability", durationOptions, { after: otherDuration })}
      <Section
        title="Move-in Date"
        className="mt-6"
        large={drawer}
        onClear={clearer("moveInMonth", "moveInDay", "moveInDate")}
      >
        {/* Month alone shows everything you could move into by the end of the
            next such month: what is available now, plus what opens before
            then. A day makes it by that day of the month. The day needs a
            month first. */}
        <div className={`ml-5 mt-2 flex gap-2 ${drawer ? "w-[280px]" : "w-[236px]"}`}>
          {moveInSelect(
            "Month",
            "moveInMonth",
            MONTHS.map((name, i) => [String(i + 1), name]),
            "flex-[3]",
            // A shorter month drops a day it does not have.
            (month) => ({
              moveInDate: "",
              moveInDay:
                month && Number(draft.moveInDay) <= DAYS_IN_MONTH[month - 1]
                  ? draft.moveInDay
                  : "",
            })
          )}
          {moveInSelect(
            "Day",
            "moveInDay",
            Array.from(
              { length: DAYS_IN_MONTH[(draft.moveInMonth || 1) - 1] },
              (_, i) => [String(i + 1), String(i + 1)]
            ),
            "flex-[2]",
            undefined,
            !draft.moveInMonth
          )}
        </div>
      </Section>
      {chips("Home Type", "mt-6", "homeType", HOME_TYPES)}
      {chips("Amenities", "mt-6", "amenities", AMENITIES)}
      {chips("Utilities Included", "mt-6", "utilitiesIncluded", UTILITIES)}
      {chips("Furnished", "mt-6", "furnished", FURNISHED, { single: true })}

      <div className="mt-7 px-5 text-[10px] leading-[13px] text-[#F71C1E]">
        <p>Not seeing what you want?</p>
        <p>{"Tell us about what you're looking for, and we'll find it for you!"}</p>
      </div>
      <Link
        href="/matchmaking"
        className="ml-5 mt-2.5 flex h-5 w-[100px] items-center justify-center rounded-full border border-[#F71C1E] bg-[#fff5f5] text-[10px] font-bold text-[#F71C1E]"
      >
        Find Your Place
      </Link>
      </div>

      {drawer && (
        <div className="flex shrink-0 gap-3 border-t border-[#E6E7EB] px-4 py-3">
          {clearAll("h-9 px-5 text-[13px] border-gray-300")}
          <button
            type="button"
            onClick={() => onApply(draft)}
            className="h-9 flex-1 rounded-full bg-[#F00013] text-[13px] font-medium text-white transition-opacity hover:opacity-90"
          >
            Apply Your Filter Preference
          </button>
        </div>
      )}
    </div>
  );
}
