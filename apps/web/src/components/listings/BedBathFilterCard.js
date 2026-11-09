"use client";

import { useState } from "react";
import {
  FilterCard,
  StepRange,
  stepIndex,
  stepLimits,
  BED_STEPS,
  BATH_STEPS,
} from "@/components/listings/FilterComponents";

function StepSection({ title, steps, range, onChange }) {
  return (
    <div>
      <p className="px-6 text-base font-semibold leading-5 text-black">{title}</p>
      <div className="mt-2 pl-[26px] pr-[21px]">
        <StepRange
          steps={steps}
          low={range.low}
          high={range.high}
          onChange={(low, high) => onChange({ low, high })}
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
    low: stepIndex(BED_STEPS, filters.bedrooms, 0),
    high: stepIndex(BED_STEPS, filters.maxBedrooms, BED_STEPS.length - 1),
  });
  const [baths, setBaths] = useState({
    low: stepIndex(BATH_STEPS, filters.bathrooms, 0),
    high: stepIndex(BATH_STEPS, filters.maxBathrooms, BATH_STEPS.length - 1),
  });

  return (
    <FilterCard
      title="Bedrooms & Bathrooms"
      onApply={() => {
        const [bedrooms, maxBedrooms] = stepLimits(BED_STEPS, beds);
        const [bathrooms, maxBathrooms] = stepLimits(BATH_STEPS, baths);
        onApply({ bedrooms, maxBedrooms, bathrooms, maxBathrooms });
      }}
    >
      <div className="mt-3.5 space-y-5">
        <StepSection title="Bedrooms" steps={BED_STEPS} range={beds} onChange={setBeds} />
        <StepSection title="Bathrooms" steps={BATH_STEPS} range={baths} onChange={setBaths} />
      </div>
    </FilterCard>
  );
}
