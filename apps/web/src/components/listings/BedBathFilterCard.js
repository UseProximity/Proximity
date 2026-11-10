"use client";

import { useMemo, useState } from "react";
import {
  FilterCard,
  ClearFilter,
  StepRange,
  useLiveFilters,
  stepIndex,
  stepLimits,
  BED_STEPS,
  BATH_STEPS,
} from "@/components/listings/FilterComponents";

function StepSection({ title, steps, range, onChange }) {
  return (
    <div>
      <p className="flex items-baseline gap-2 px-4 text-xs font-semibold leading-4 text-gray-900">
        {title}
        {(range.low > 0 || range.high < steps.length - 1) && (
          <ClearFilter onClear={() => onChange({ low: 0, high: steps.length - 1 })} />
        )}
      </p>
      <div className="mt-1.5 px-4">
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

// Bedrooms & Bathrooms card of the Beds & Baths dropdown. onChange gets the
// four filter values (bedrooms, maxBedrooms, bathrooms, maxBathrooms), "" at
// the 0 / 1 and 5+ / 4+ ends meaning no limit, as they change.
export default function BedBathFilterCard({ filters, onChange }) {
  const [beds, setBeds] = useState({
    low: stepIndex(BED_STEPS, filters.bedrooms, 0),
    high: stepIndex(BED_STEPS, filters.maxBedrooms, BED_STEPS.length - 1),
  });
  const [baths, setBaths] = useState({
    low: stepIndex(BATH_STEPS, filters.bathrooms, 0),
    high: stepIndex(BATH_STEPS, filters.maxBathrooms, BATH_STEPS.length - 1),
  });

  const ranges = useMemo(() => ({ beds, baths }), [beds, baths]);
  useLiveFilters(ranges, (r) => {
    const [bedrooms, maxBedrooms] = stepLimits(BED_STEPS, r.beds);
    const [bathrooms, maxBathrooms] = stepLimits(BATH_STEPS, r.baths);
    onChange({ bedrooms, maxBedrooms, bathrooms, maxBathrooms });
  });

  return (
    <FilterCard title="Bedrooms & Bathrooms">
      <div className="mt-3 space-y-3">
        <StepSection title="Bedrooms" steps={BED_STEPS} range={beds} onChange={setBeds} />
        <StepSection title="Bathrooms" steps={BATH_STEPS} range={baths} onChange={setBaths} />
      </div>
    </FilterCard>
  );
}
