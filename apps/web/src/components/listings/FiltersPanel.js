"use client";

import { useState } from "react";
import Link from "next/link";
import { DEFAULT_FILTERS } from "@/lib/listings/filterListings";
import {
  StepRange,
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

const ACCENT = "#FF2B3A";

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
const LEASE_AVAILABILITY = [
  { label: "Semester Lease", value: "semester" },
  { label: "10-Month Lease", value: "10-month" },
  { label: "12-Month Lease", value: "12-month" },
  { label: "Summer Lease", value: "summer" },
];
const HOME_TYPES = [
  { label: "Apartment", value: "apartment" },
  { label: "House", value: "house" },
  { label: "Studio", value: "studio" },
  { label: "Townhouse", value: "townhouse" },
  { label: "Single Room", value: "single_room" },
  { label: "Condo", value: "condo" },
];
const AMENITIES = [
  { label: "Dishwasher", value: "dishwasher" },
  { label: "In-Unit Laundry", value: "in_unit_laundry" },
  { label: "AC / Heating", value: "ac_heating" },
  { label: "Mailroom", value: "mailroom" },
  { label: "Pets Allowed", value: "pets_allowed" },
  { label: "Extra Storage", value: "extra_storage" },
  { label: "Fireplace", value: "fireplace" },
  { label: "Private Parking", value: "private_parking" },
  { label: "Pool", value: "pool" },
  { label: "Study Rooms", value: "study_room" },
  { label: "Gym / Fitness", value: "gym" },
];
const UTILITIES = [
  { label: "Water", value: "water" },
  { label: "Electric", value: "electric" },
  { label: "Gas", value: "gas" },
  { label: "Internet", value: "internet" },
  { label: "Trash", value: "trash" },
  { label: "Hot Water", value: "hotWater" },
  { label: "Sewer", value: "sewer" },
  { label: "Yard Care", value: "yardCare" },
];
const FURNISHED = [
  { label: "Any", value: "" },
  { label: "Furnished", value: "furnished" },
  { label: "Unfurnished", value: "unfurnished" },
];

const PILL =
  "h-[21px] rounded-full border border-gray-300 text-[11px] font-medium text-[#495564] hover:bg-gray-50";

// A titled block. className places it (its top margin), inset is the title's
// and chips' left padding: the design does not keep one left edge.
function Section({ title, className = "", inset = "pl-6", children }) {
  return (
    <div className={className}>
      <p className={`${inset} text-sm font-bold leading-[17px] text-black`}>{title}</p>
      {children}
    </div>
  );
}

// Side filters panel of the browse page. It edits its own copy of the filters;
// onApply gets that copy, onReset clears the site's filters and search.
export default function FiltersPanel({ listings, filters, onApply, onReset }) {
  const [draft, setDraft] = useState(filters);
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));
  const toggle = (field, value) =>
    setDraft((d) => {
      const cur = d[field] || [];
      return {
        ...d,
        [field]: cur.includes(value)
          ? cur.filter((v) => v !== value)
          : [...cur, value],
      };
    });

  const slider = (title, className, children) => (
    <Section title={title} className={className}>
      <div className="ml-[39px] mr-[51px] mt-4">{children}</div>
    </Section>
  );
  const stepSlider = (title, className, steps, lowKey, highKey) =>
    slider(
      title,
      className,
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
      <StepRange
        steps={steps}
        accent={ACCENT}
        single
        high={stepIndex(steps, draft[field], steps.length - 1)}
        onChange={(_, high) => set({ [field]: steps[high].value })}
      />
    );
  // Chips: several can be on (field holds an array), or with single exactly one.
  const chips = (title, className, field, options, { inset, single } = {}) => (
    <Section title={title} className={className} inset={inset}>
      <div className={`mt-2.5 flex max-w-[316px] flex-wrap gap-x-2 gap-y-2.5 ${inset || "pl-6"}`}>
        {options.map(({ label, value }) => {
          const selected = single
            ? (draft[field] || "") === value
            : (draft[field] || []).includes(value);
          return (
            <button
              key={value}
              type="button"
              onClick={() => (single ? set({ [field]: value }) : toggle(field, value))}
              className={`h-[22px] rounded-full border px-3.5 text-[11px] font-medium shadow-[0_1px_2px_rgba(0,0,0,0.12)] transition-colors ${
                selected
                  ? "border-[#FF2B3A] bg-[#FF2B3A] text-white"
                  : "border-gray-200 bg-white text-[#495564] hover:border-gray-300"
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>
    </Section>
  );

  const price = rentRange(draft.minRent, draft.maxRent);

  return (
    <div className="min-h-0 w-[363px] overflow-y-auto rounded-[28px] border border-gray-200 bg-white pb-[28px] pt-[26px] shadow-xl">
      <div className="flex items-center justify-between pl-[18px] pr-[23px]">
        <h2 className="text-[17px] font-semibold leading-[21px] text-black">
          Filters By:
        </h2>
        <button
          type="button"
          onClick={() => {
            onReset();
            setDraft(DEFAULT_FILTERS);
          }}
          className={`${PILL} w-[77px]`}
        >
          Clear All
        </button>
      </div>
      <button
        type="button"
        onClick={() => onApply(draft)}
        className={`${PILL} ml-4 mt-2 w-[186px]`}
      >
        Apply Your Filter Preference
      </button>

      <Section title="Price Range" className="mt-4" inset="pl-4">
        <PriceRangeSlider
          listings={listings}
          low={price.low}
          high={price.high}
          onChange={(low, high) => set(rentFilters({ low, high }))}
          barsClass="ml-[54px] mr-[68px] mt-3 h-[83px]"
          sliderClass="-mt-2 ml-[39px] mr-[51px]"
          accent={ACCENT}
          highlight={!!(draft.minRent || draft.maxRent)}
        />
      </Section>
      {stepSlider("Bedrooms", "mt-7", BED_STEPS, "bedrooms", "maxBedrooms")}
      {stepSlider("Bathrooms", "mt-[31px]", BATH_STEPS, "bathrooms", "maxBathrooms")}
      {distanceSlider("Walking Distance to Campus", "mt-[29px]", CAMPUS_STEPS, "distance")}
      {distanceSlider("Walking Distance to Shuttle", "mt-[29px]", SHUTTLE_STEPS, "distanceToShuttle")}
      {chips("Lease Availability", "mt-[35px]", "leaseAvailability", LEASE_AVAILABILITY)}
      <Section title="Move-in Date" className="mt-[35px]">
        <input
          type="date"
          value={draft.moveInDate || ""}
          onChange={(e) => set({ moveInDate: e.target.value })}
          className="ml-6 mt-2.5 h-9 w-[280px] rounded-lg border border-gray-300 bg-white px-3 text-[11px] text-gray-900"
        />
      </Section>
      {chips("Home Type", "mt-10", "homeType", HOME_TYPES)}
      {chips("Amenities", "mt-[37px]", "amenities", AMENITIES)}
      {chips("Utilities Included", "mt-9", "utilitiesIncluded", UTILITIES, { inset: "pl-[21px]" })}
      {chips("Furnished", "mt-9", "furnished", FURNISHED, { single: true })}

      <div className="mt-[43px] pl-[21px] text-[11px] leading-[14px] text-[#F71C1E]">
        <p>Not seeing what you want?</p>
        <p>{"Tell us about what you're looking for, and we'll find it for you!"}</p>
      </div>
      <Link
        href="/matchmaking"
        className="ml-[21px] mt-[13px] flex h-[22px] w-[112px] items-center justify-center rounded-full border border-[#F71C1E] bg-[#fff5f5] text-[11px] font-bold text-[#F71C1E]"
      >
        Find Your Place
      </Link>
    </div>
  );
}
