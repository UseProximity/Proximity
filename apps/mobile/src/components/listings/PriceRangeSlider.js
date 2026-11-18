// Price Range of the filter sheet, as on the website: a histogram of the rents
// of the listings that fit the other filters (rents, from the shared
// fittingRents), with the range slider under it. The bars inside the selected
// range are red, so with no range chosen they all are. A bar's height comes
// from its count, so it is set inline.
import { useMemo } from "react";
import { View } from "react-native";
import {
  PRICE_MIN,
  PRICE_MAX,
  PRICE_STEP,
  PRICE_BAR_COUNT,
  priceBuckets,
  formatPrice,
} from "@proximity/shared";
import { RangeSlider } from "../ui/RangeSlider";

// Width of one histogram bar, in dollars.
const BUCKET = (PRICE_MAX - PRICE_MIN) / PRICE_BAR_COUNT;

export function PriceRangeSlider({ rents, low, high, onChange, onDragging }) {
  const counts = useMemo(() => priceBuckets(rents), [rents]);
  const tallest = Math.max(...counts, 1);
  return (
    <View>
      {/* As on the website, the bars start and end a little inside the track's
          ends (which are half a handle, 11pt, in from the slider's edges). */}
      <View className="flex-row items-end gap-0.5 h-16 pl-5 pr-[22px]">
        {counts.map((count, i) => {
          const start = PRICE_MIN + i * BUCKET;
          const inRange = start < high && start + BUCKET > low;
          return (
            <View
              key={i}
              className={`flex-1 ${inRange ? "bg-red-600" : "bg-gray-200"}`}
              style={{ height: `${(count / tallest) * 90}%` }}
            />
          );
        })}
      </View>
      {/* Pulled up by half the slider's 44pt touch row, so the track runs along
          the bottom of the bars, as on the website. */}
      <View className="-mt-[22px]">
        <RangeSlider
          min={PRICE_MIN}
          max={PRICE_MAX}
          step={PRICE_STEP}
          low={low}
          high={high}
          label="Price"
          onChange={onChange}
          onDragging={onDragging}
          formatLabel={formatPrice}
        />
      </View>
    </View>
  );
}
