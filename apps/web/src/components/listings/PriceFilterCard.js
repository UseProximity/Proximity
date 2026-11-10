"use client";

import { useMemo, useState } from "react";
import {
  FilterCard,
  RangeSlider,
  useLiveFilters,
  accentClasses,
  PRICE_MIN,
  PRICE_MAX,
  PRICE_STEP,
} from "@/components/listings/FilterComponents";

const BAR_COUNT = 20;
const BUCKET = (PRICE_MAX - PRICE_MIN) / BAR_COUNT;

// Rents per price bucket. Prices outside the slider's range fall into the
// first and last bars, so the last bar is the "$4000+" bucket.
function priceBuckets(rents) {
  const counts = new Array(BAR_COUNT).fill(0);
  rents.forEach((rent) => {
    const i = Math.floor((rent - PRICE_MIN) / BUCKET);
    counts[Math.min(BAR_COUNT - 1, Math.max(0, i))] += 1;
  });
  return counts;
}

const formatPrice = (v) => (v >= PRICE_MAX ? "$4000+" : `$${v.toLocaleString()}`);

// Slider range for the minRent / maxRent filter strings, and back: "" at either
// end means no limit.
export const rentRange = (minRent, maxRent) => ({
  low: minRent ? Math.max(PRICE_MIN, Number(minRent)) : PRICE_MIN,
  high: maxRent ? Math.min(PRICE_MAX, Number(maxRent)) : PRICE_MAX,
});
export const rentFilters = ({ low, high }) => ({
  minRent: low <= PRICE_MIN ? "" : String(low),
  maxRent: high >= PRICE_MAX ? "" : String(high),
});

// Histogram of rents (see fittingRents: the available listings that fit the
// other filters) with the range slider under it, so it changes as the other
// filters do. The bars inside the selected range are drawn in the accent
// colour, so with no range chosen they all are. barsClass and sliderClass place the two (the bars' height
// included). A bar's own height comes from its count, so it is set inline.
export function PriceRangeSlider({
  rents,
  low,
  high,
  onChange,
  barsClass,
  sliderClass,
  accent,
}) {
  const counts = useMemo(() => priceBuckets(rents), [rents]);
  const tallest = Math.max(...counts, 1);
  const red = accentClasses(accent);
  return (
    <>
      <div className={`flex items-end gap-[2px] ${barsClass}`}>
        {counts.map((count, i) => {
          const start = PRICE_MIN + i * BUCKET;
          const inRange = start < high && start + BUCKET > low;
          return (
            <div
              key={i}
              className={`flex-1 ${inRange ? red.bg : "bg-gray-200"}`}
              style={{ height: `${(count / tallest) * 90}%` }}
            />
          );
        })}
      </div>
      <div className={sliderClass}>
        <RangeSlider
          min={PRICE_MIN}
          max={PRICE_MAX}
          step={PRICE_STEP}
          accent={accent}
          low={low}
          high={high}
          onChange={onChange}
          formatLabel={formatPrice}
        />
      </div>
    </>
  );
}

// Allowed values of each box: the min stays a step below the max, the max a
// step above the min.
const bounds = (field, { low, high }) =>
  field === "low" ? [PRICE_MIN, high - PRICE_STEP] : [low + PRICE_STEP, PRICE_MAX];

// Price Range card of the Price dropdown: the rent histogram, the range
// slider and Min and Max boxes. onChange gets { minRent, maxRent } as
// filter strings ("" meaning no limit) as the range changes.
export default function PriceFilterCard({ rents, minRent, maxRent, onChange }) {
  const [range, setRange] = useState(rentRange(minRent, maxRent));
  useLiveFilters(range, (r) => onChange(rentFilters(r)));
  // What is being typed in a box ({ field, text }), until the box loses focus.
  const [typing, setTyping] = useState(null);

  const shown = {
    low: String(range.low),
    high: range.high >= PRICE_MAX ? `${PRICE_MAX}+` : String(range.high),
  };
  const setField = (field, value) => setRange((r) => ({ ...r, [field]: value }));

  const onType = (field, raw) => {
    const text = raw.replace(/\D/g, "");
    setTyping({ field, text });
    // The handle follows as soon as the number is valid; anything else is
    // clamped into range when the box loses focus.
    const [lo, hi] = bounds(field, range);
    const v = Number(text);
    if (text && v >= lo && (field === "high" || v <= hi)) {
      setField(field, Math.min(v, hi));
    }
  };
  const onCommit = (field) => {
    if (typing?.field !== field) return;
    const [lo, hi] = bounds(field, range);
    setField(
      field,
      typing.text
        ? Math.min(hi, Math.max(lo, Number(typing.text)))
        : field === "low"
          ? PRICE_MIN
          : PRICE_MAX
    );
    setTyping(null);
  };

  return (
    <FilterCard
      title="Price Range"
      onClear={
        range.low > PRICE_MIN || range.high < PRICE_MAX
          ? () => setRange({ low: PRICE_MIN, high: PRICE_MAX })
          : undefined
      }
    >
      <PriceRangeSlider
        rents={rents}
        low={range.low}
        high={range.high}
        onChange={(low, high) => setRange({ low, high })}
        barsClass="mt-3 ml-[34px] mr-[36px] h-[72px]"
        sliderClass="-mt-2 px-4"
        accent="card"
      />
      <div className="mt-2 flex gap-2 px-4">
        {[
          ["low", "Min price"],
          ["high", "Max price"],
        ].map(([field, label]) => (
          <label
            key={field}
            className="flex-1 rounded-lg border border-gray-300 px-2.5 py-1 focus-within:border-[#F71C1E]"
          >
            <span className="block text-[10px] leading-none text-gray-500">
              {label}
            </span>
            <span className="mt-0.5 flex items-center gap-0.5 text-xs text-gray-900">
              $
              <input
                inputMode="numeric"
                value={typing?.field === field ? typing.text : shown[field]}
                onFocus={(e) => e.target.select()}
                onChange={(e) => onType(field, e.target.value)}
                onBlur={() => onCommit(field)}
                onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                className="w-full bg-transparent outline-none"
              />
            </span>
          </label>
        ))}
      </div>
    </FilterCard>
  );
}
