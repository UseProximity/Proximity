"use client";

import { useState } from "react";
import {
  FilterCard,
  RangeSlider,
  BED_STEPS,
  BATH_STEPS,
} from "@/components/listings/FilterComponents";

// Index of a filter value in steps; "" means the open end (fallback).
const indexOf = (steps, value, fallback) =>
  value ? Math.max(0, steps.findIndex((s) => s.value === value)) : fallback;

// Filter strings for a range of step indexes: "" at either end means no limit.
const limits = (steps, { low, high }) => [
  low === 0 ? "" : steps[low].value,
  high === steps.length - 1 ? "" : steps[high].value,
];

function StepRange({ title, steps, range, onChange }) {
  return (
    <div>
      <p className="px-6 text-base font-semibold leading-5 text-black">{title}</p>
      <div className="mt-2 pl-[26px] pr-[21px]">
        <RangeSlider
          min={0}
          max={steps.length - 1}
          minGap={0}
          low={range.low}
          high={range.high}
          onChange={(low, high) => onChange({ low, high })}
          ticks={steps.map((s) => s.label)}
        />
      </div>
    </div>
  );
}

// Bedrooms & Bathrooms card of the Beds & Baths dropdown. onApply gets the
// four filter values (bedrooms, maxBedrooms, bathrooms, maxBathrooms), "" at
// the 0 / 1 and 5+ / 4+ ends meaning no limit.
export default function BedBathFilterCard({ filters, onApply }) {
  const [beds, setBeds] = useState({
    low: indexOf(BED_STEPS, filters.bedrooms, 0),
    high: indexOf(BED_STEPS, filters.maxBedrooms, BED_STEPS.length - 1),
  });
  const [baths, setBaths] = useState({
    low: indexOf(BATH_STEPS, filters.bathrooms, 0),
    high: indexOf(BATH_STEPS, filters.maxBathrooms, BATH_STEPS.length - 1),
  });

  return (
    <FilterCard
      title="Bedrooms & Bathrooms"
      onApply={() => {
        const [bedrooms, maxBedrooms] = limits(BED_STEPS, beds);
        const [bathrooms, maxBathrooms] = limits(BATH_STEPS, baths);
        onApply({ bedrooms, maxBedrooms, bathrooms, maxBathrooms });
      }}
    >
      <div className="mt-3.5 space-y-5">
        <StepRange title="Bedrooms" steps={BED_STEPS} range={beds} onChange={setBeds} />
        <StepRange title="Bathrooms" steps={BATH_STEPS} range={baths} onChange={setBaths} />
      </div>
    </FilterCard>
  );
}
