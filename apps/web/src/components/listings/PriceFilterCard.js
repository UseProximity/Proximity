"use client";

import { useMemo, useState } from "react";
import {
  RangeSlider,
  PRICE_MIN,
  PRICE_MAX,
  PRICE_STEP,
} from "@/components/listings/FilterComponents";

const BAR_COUNT = 20;
const BUCKET = (PRICE_MAX - PRICE_MIN) / BAR_COUNT;

// Listings per price bucket. Prices outside the slider's range fall into the
// first and last bars, so the last bar is the "$4000+" bucket.
function priceBuckets(listings) {
  const counts = new Array(BAR_COUNT).fill(0);
  listings.forEach((l) => {
    if (l.minRent == null) return;
    const i = Math.floor((l.minRent - PRICE_MIN) / BUCKET);
    counts[Math.min(BAR_COUNT - 1, Math.max(0, i))] += 1;
  });
  return counts;
}

const formatPrice = (v) => (v >= PRICE_MAX ? "$4000+" : `$${v.toLocaleString()}`);

// Allowed values of each box: the min stays a step below the max, the max a
// step above the min.
const bounds = (field, { low, high }) =>
  field === "low" ? [PRICE_MIN, high - PRICE_STEP] : [low + PRICE_STEP, PRICE_MAX];

// Price Range card of the Price dropdown: histogram of every listing's price,
// the range slider, Min and Max boxes and Apply. onApply gets
// { minRent, maxRent } as filter strings, "" meaning no limit.
export default function PriceFilterCard({ listings, minRent, maxRent, onApply }) {
  const [range, setRange] = useState({
    low: minRent ? Math.max(PRICE_MIN, Number(minRent)) : PRICE_MIN,
    high: maxRent ? Math.min(PRICE_MAX, Number(maxRent)) : PRICE_MAX,
  });
  // What is being typed in a box ({ field, text }), until the box loses focus.
  const [typing, setTyping] = useState(null);
  const counts = useMemo(() => priceBuckets(listings), [listings]);
  const tallest = Math.max(...counts, 1);

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
    <div className="w-80 overflow-hidden rounded-[28px] border border-gray-300 bg-white shadow-xl">
      <h3 className="bg-[#ffefef] px-6 py-3.5 text-[17px] font-semibold leading-[21px] text-black">
        Price Range
      </h3>
      <div className="pb-4 pt-3">
        <div className="ml-[47px] mr-[38px] flex h-[125px] items-end gap-[3.34px]">
          {counts.map((count, i) => {
            const start = PRICE_MIN + i * BUCKET;
            const inRange = start < range.high && start + BUCKET > range.low;
            return (
              <div
                key={i}
                className={`flex-1 ${inRange ? "bg-[#F71C1E]" : "bg-gray-200"}`}
                style={{ height: `${(count / tallest) * 90}%` }}
              />
            );
          })}
        </div>
        <div className="-mt-2 pl-[29px] pr-[18px]">
          <RangeSlider
            min={PRICE_MIN}
            max={PRICE_MAX}
            step={PRICE_STEP}
            low={range.low}
            high={range.high}
            onChange={(low, high) => setRange({ low, high })}
            formatLabel={formatPrice}
          />
        </div>
        <div className="mt-3 flex gap-3 px-6">
          {[
            ["low", "Min price"],
            ["high", "Max price"],
          ].map(([field, label]) => (
            <label
              key={field}
              className="flex-1 rounded-lg border border-gray-300 px-3 py-1.5 focus-within:border-[#F71C1E]"
            >
              <span className="block text-[11px] leading-none text-gray-500">
                {label}
              </span>
              <span className="mt-1 flex items-center gap-0.5 text-sm text-gray-900">
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
        <button
          onClick={() =>
            onApply({
              minRent: range.low <= PRICE_MIN ? "" : String(range.low),
              maxRent: range.high >= PRICE_MAX ? "" : String(range.high),
            })
          }
          className="mx-auto mt-4 block h-7 w-[84px] rounded-full bg-[#F00013] text-[17px] text-white transition-opacity hover:opacity-90"
        >
          Apply
        </button>
      </div>
    </div>
  );
}
